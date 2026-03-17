/**
 * Main Express API for Cloud Codex
 * 
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import express from 'express';
import ViteExpress from 'vite-express';

import authRoutes from './routes/auth.js';
import searchRoutes from './routes/search.js';
import documentRoutes from './routes/documents.js';
import projectsRouter from './routes/projects.js';
import organizationsRouter from './routes/organizations.js';
import teamsRouter from './routes/teams.js';

const app = express();

app.use(express.json({ limit: '2mb' }));

// Mount route groups
app.use('/api', authRoutes);
app.use('/api', searchRoutes);
app.use('/api', projectsRouter);
app.use('/api', documentRoutes);
app.use('/api', organizationsRouter);
app.use('/api', teamsRouter);

ViteExpress.listen(app, 3000, () => {
  console.log('CloudCodex API Server is running on http://localhost:3000');
});
