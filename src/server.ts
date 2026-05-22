import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import authRoutes from './routes/authRoutes.js';
import platformRoutes from './routes/platformRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import userRoutes from './routes/userRoutes.js';
import jobListingRoutes from './routes/jobListingRoutes.js';
import meetingRoutes from './routes/meetingRoutes.js';
import feedbackLogRoutes from './routes/feedbackLogRoutes.js';
import clubRoutes from './routes/clubRoutes.js';
import systemLogRoutes from './routes/systemLogRoutes.js';
import questionRoutes from './routes/questionRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler.js';

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3001,http://127.0.0.1:3001').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, env: config.nodeEnv }));

// ─── Platform yöneticisi (tenant sisteminin dışında) ────────────────────────
app.use('/api/platform', platformRoutes);

// ─── Kimlik doğrulama (tenant gerektirmez) ───────────────────────────────────
app.use('/api/auth', authRoutes);

// ─── Global tenant yönetimi ──────────────────────────────────────────────────
app.use('/api/tenants', tenantRoutes);

// ─── Tenant-scope endpoint'ler ───────────────────────────────────────────────
app.use('/api', userRoutes);
app.use('/api/job-listings', jobListingRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/feedback-logs', feedbackLogRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/system-logs', systemLogRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/analytics', analyticsRoutes);

// Hata yönetimi — route'lardan sonra olmalı
app.use(notFoundHandler);
app.use(globalErrorHandler);

const server = app.listen(config.port, () => {
  console.log(`API ayakta: http://localhost:${config.port} [${config.nodeEnv}]`);
});

process.on('SIGTERM', async () => {
  server.close(async () => {
    const { prisma } = await import('./db.js');
    await prisma.$disconnect();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  server.close(async () => {
    const { prisma } = await import('./db.js');
    await prisma.$disconnect();
    process.exit(0);
  });
});
