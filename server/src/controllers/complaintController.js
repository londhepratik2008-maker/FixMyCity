import { Complaint, RepairSubmission, VerificationResult, Notification, User } from '../models/index.js';

const generateComplaintId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `FM-${year}-${random}`;
};

const assignAuthority = ({ title = '', description = '', address = '', severity = 'medium' } = {}) => {
  const text = `${title} ${description} ${address}`.toLowerCase();
  const isHighway = /highway|expressway|motorway|freeway|ring road|bypass|nh-|sh-/.test(text);
  if (isHighway || severity === 'critical') {
    return 'PWD Division, Thane';
  }
  return 'Thane Municipal Corporation (TMC)';
};

const createNotification = async (userId, type, title, message, relatedComplaintId = null, relatedRepairSubmissionId = null) => {
  await Notification.create({
    userId,
    type,
    title,
    message,
    relatedComplaintId,
    relatedRepairSubmissionId
  });
};

const sanitizeReportAnalysis = (raw) => {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const evidenceStatuses = ['ACCEPTED', 'INVALID_EVIDENCE', 'MANUAL_REVIEW'];
  const statuses = ['POTHOLE_DETECTED', 'NO_POTHOLE', 'ERROR'];
  const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const qualities = ['GOOD', 'FAIR', 'POOR', 'INSUFFICIENT'];

  const confidence = Number(parsed.confidence);
  const result = {
    evidenceStatus: evidenceStatuses.includes(parsed.evidenceStatus) ? parsed.evidenceStatus : undefined,
    status: statuses.includes(parsed.status) ? parsed.status : undefined,
    isPothole: typeof parsed.isPothole === 'boolean' ? parsed.isPothole : undefined,
    confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, Math.round(confidence))) : undefined,
    severity: severities.includes(String(parsed.severity || '').toUpperCase())
      ? String(parsed.severity).toUpperCase()
      : null,
    defectType: typeof parsed.defectType === 'string' ? parsed.defectType.slice(0, 120) : undefined,
    description: typeof parsed.description === 'string' ? parsed.description.slice(0, 1000) : undefined,
    environment: typeof parsed.environment === 'string' ? parsed.environment.slice(0, 1000) : undefined,
    evidenceQuality: qualities.includes(String(parsed.evidenceQuality || '').toUpperCase())
      ? String(parsed.evidenceQuality).toUpperCase()
      : null,
    message: typeof parsed.message === 'string' ? parsed.message.slice(0, 1000) : undefined,
    analyzedAt: parsed.analyzedAt && !Number.isNaN(Date.parse(parsed.analyzedAt))
      ? new Date(parsed.analyzedAt)
      : new Date()
  };

  Object.keys(result).forEach((k) => result[k] === undefined && delete result[k]);
  if (!result.evidenceStatus && !result.status && result.confidence === undefined) return null;
  return result;
};

export const createComplaint = async (req, res) => {
  try {
    const { title, description, severity, latitude, longitude, address, reportAnalysis } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Image is required' });
    }

    const complaintId = generateComplaintId();
    const assignedAuthority = assignAuthority({ title, description, address, severity });
    const sanitizedAnalysis = sanitizeReportAnalysis(reportAnalysis);

    const complaint = await Complaint.create({
      complaintId,
      citizenId: req.user._id,
      title,
      description,
      severity,
      imageUrl,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      address,
      assignedAuthority,
      status: 'REPORTED',
      reportedAt: new Date(),
      ...(sanitizedAnalysis ? { reportAnalysis: sanitizedAnalysis } : {})
    });

    await createNotification(
      req.user._id,
      'COMPLAINT_SUBMITTED',
      'Complaint Submitted',
      `Your complaint ${complaintId} has been submitted successfully.`,
      complaint._id
    );

    const municipalUsers = await User.find({ role: 'municipal', isActive: true });
    for (const municipal of municipalUsers) {
      await createNotification(
        municipal._id,
        'NEW_COMPLAINT',
        'New Pothole Reported',
        `New complaint ${complaintId} reported in your area.`,
        complaint._id
      );
    }

    res.status(201).json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create complaint' });
  }
};

export const getMyComplaints = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = { citizenId: req.user._id };
    
    if (status) {
      query.status = status;
    }

    const complaints = await Complaint.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('contractorId', 'name')
      .populate('repairSubmissionId')
      .populate('verificationResultId');

    const total = await Complaint.countDocuments(query);

    res.json({
      complaints,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
};

export const getComplaintById = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .populate('citizenId', 'name email phone')
      .populate('contractorId', 'name email phone')
      .populate('repairSubmissionId')
      .populate('verificationResultId');

    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    if (complaint.citizenId._id.toString() !== req.user._id.toString() && 
        req.user.role !== 'municipal' && 
        req.user.role !== 'contractor') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
};

export const getAllComplaints = async (req, res) => {
  try {
    const { status, severity, page = 1, limit = 20, search } = req.query;
    const query = {};

    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      query.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (severity) query.severity = severity;
    if (search) {
      query.$or = [
        { complaintId: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const complaints = await Complaint.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('citizenId', 'name email phone')
      .populate('contractorId', 'name email phone')
      .populate('repairSubmissionId')
      .populate('verificationResultId');

    const total = await Complaint.countDocuments(query);

    res.json({
      complaints,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
};

export const updateComplaintStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['REPORTED', 'ASSIGNED', 'UNDER_REPAIR', 'VERIFICATION', 'VERIFIED', 'MANUAL_REVIEW', 'REJECTED', 'RESOLVED'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const oldStatus = complaint.status;
    complaint.status = status;
    
    if (status === 'ASSIGNED' && !complaint.assignedAt) {
      complaint.assignedAt = new Date();
    }

    await complaint.save();

    const populated = await Complaint.findById(complaint._id)
      .populate('citizenId', 'name email phone')
      .populate('contractorId', 'name email phone')
      .populate('repairSubmissionId')
      .populate('verificationResultId');

    await createNotification(
      complaint.citizenId,
      'COMPLAINT_ASSIGNED',
      'Complaint Status Updated',
      `Your complaint ${complaint.complaintId} status changed from ${oldStatus} to ${status}.`,
      complaint._id
    );

    if (complaint.contractorId) {
      await createNotification(
        complaint.contractorId,
        'ASSIGNMENT_RECEIVED',
        'Assignment Update',
        `Complaint ${complaint.complaintId} status updated to ${status}.`,
        complaint._id
      );
    }

    res.json({ complaint: populated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
};

export const assignContractor = async (req, res) => {
  try {
    const { contractorId } = req.body;

    const contractor = await User.findById(contractorId);
    if (!contractor || contractor.role !== 'contractor') {
      return res.status(400).json({ error: 'Invalid contractor' });
    }

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    complaint.contractorId = contractorId;
    complaint.status = 'ASSIGNED';
    complaint.assignedAt = new Date();
    await complaint.save();

    await createNotification(
      complaint.citizenId,
      'COMPLAINT_ASSIGNED',
      'Contractor Assigned',
      `Contractor ${contractor.name} has been assigned to your complaint ${complaint.complaintId}.`,
      complaint._id
    );

    await createNotification(
      contractorId,
      'ASSIGNMENT_RECEIVED',
      'New Repair Assignment',
      `You have been assigned to complaint ${complaint.complaintId}.`,
      complaint._id
    );

    res.json({ complaint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign contractor' });
  }
};

export const getDashboardStats = async (req, res) => {
  try {
    const stats = await Promise.all([
      Complaint.countDocuments(),
      Complaint.countDocuments({ status: 'REPORTED' }),
      Complaint.countDocuments({ status: 'ASSIGNED' }),
      Complaint.countDocuments({ status: 'UNDER_REPAIR' }),
      Complaint.countDocuments({ status: 'VERIFICATION' }),
      Complaint.countDocuments({ status: 'VERIFIED' }),
      Complaint.countDocuments({ status: 'MANUAL_REVIEW' }),
      Complaint.countDocuments({ status: 'REJECTED' }),
      Complaint.countDocuments({ status: 'RESOLVED' }),
      Complaint.aggregate([
        { $group: { _id: '$severity', count: { $sum: 1 } } }
      ]),
      Complaint.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const severityStats = stats[9].reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const statusStats = stats[10].reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const resolvedComplaints = await Complaint.find({ status: 'RESOLVED' }).select('createdAt updatedAt');
    const avgResolutionTime = resolvedComplaints.length > 0
      ? resolvedComplaints.reduce((sum, c) => sum + (c.updatedAt - c.createdAt), 0) / resolvedComplaints.length
      : 0;

    const verifiedCount = await VerificationResult.countDocuments({ decision: 'VERIFIED' });
    const rejectedCount = await VerificationResult.countDocuments({ decision: 'REJECTED' });
    const manualReviewCount = await VerificationResult.countDocuments({ decision: 'MANUAL_REVIEW' });
    const totalVerifications = verifiedCount + rejectedCount + manualReviewCount;

    res.json({
      totalComplaints: stats[0],
      reported: stats[1],
      assigned: stats[2],
      underRepair: stats[3],
      verification: stats[4],
      verified: stats[5],
      manualReview: stats[6],
      rejected: stats[7],
      resolved: stats[8],
      severityStats,
      statusStats,
      avgResolutionTimeMs: avgResolutionTime,
      verificationStats: {
        verified: verifiedCount,
        rejected: rejectedCount,
        manualReview: manualReviewCount,
        total: totalVerifications,
        verifiedRate: totalVerifications > 0 ? (verifiedCount / totalVerifications * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
};