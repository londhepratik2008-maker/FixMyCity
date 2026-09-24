import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from './app.js';
import { connectDB } from './db.js';

const PORT = process.env.PORT || 5000;

let mongod = null;

const connectWithFallback = async () => {
  try {
    await connectDB();
    return;
  } catch (error) {
    console.log('Local MongoDB not available, starting in-memory MongoDB...');
  }

  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    console.log('In-memory MongoDB connected');
  } catch (error) {
    console.error('Failed to start in-memory MongoDB:', error);
    process.exit(1);
  }
};

export const startServer = async () => {
  await connectWithFallback();
  return app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

process.on('SIGINT', async () => {
  if (mongod) {
    await mongod.stop();
  }
  await mongoose.connection.close();
  process.exit(0);
});

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, connectDB };
