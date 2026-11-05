import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// Security & parsing middlewares
app.use(helmet());
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
);
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Health root (convenience)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'AI YouTube Automation & Educational Hub API',
    version: '0.1.0',
  });
});

// API routes
app.use('/api', routes);

// 404 + centralized error handling
app.use(notFound);
app.use(errorHandler);

export default app;
