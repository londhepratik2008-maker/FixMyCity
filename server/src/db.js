import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fixmycity';
  await mongoose.connect(uri);
  console.log('MongoDB connected');
};
