import { QAPipelineService, QARequest, QAResponse } from './qa-pipeline';
import logger from '../utils/logger';

export interface QAJobData extends QARequest {
  jobId: string;
  priority?: number;
  createdAt: Date;
}

export interface QAJobResult extends QAResponse {
  jobId: string;
  processedAt: Date;
}

export class SimpleQueueService {
  private queue: QAJobData[] = [];
  private processing = new Map<string, Promise<QAJobResult>>();
  private qaPipeline: QAPipelineService;
  private isProcessing = false;

  constructor() {
    this.qaPipeline = new QAPipelineService();
    this.startProcessor();
  }

  async addQAJob(
    data: QARequest,
    options: {
      priority?: number;
      highPriority?: boolean;
    } = {}
  ): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const job: QAJobData = {
      ...data,
      jobId,
      priority: options.priority || (options.highPriority ? 1 : 0),
      createdAt: new Date()
    };

    if (options.highPriority) {
      this.queue.unshift(job);
    } else {
      this.queue.push(job);
    }

    // Sort by priority (higher priority first)
    this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    logger.info(`Added QA job ${jobId} for user ${data.userId} (priority: ${job.priority})`);
    
    return jobId;
  }

  async processJob(jobId: string): Promise<QAJobResult | null> {
    if (this.processing.has(jobId)) {
      return await this.processing.get(jobId)!;
    }

    const job = this.queue.find(j => j.jobId === jobId);
    if (!job) {
      return null;
    }

    const processingPromise = this.executeJob(job);
    this.processing.set(jobId, processingPromise);

    try {
      const result = await processingPromise;
      this.processing.delete(jobId);
      this.queue = this.queue.filter(j => j.jobId !== jobId);
      return result;
    } catch (error) {
      this.processing.delete(jobId);
      this.queue = this.queue.filter(j => j.jobId !== jobId);
      throw error;
    }
  }

  private async executeJob(job: QAJobData): Promise<QAJobResult> {
    logger.info(`Processing QA job ${job.jobId} for user ${job.userId}`);
    
    try {
      const result = await this.qaPipeline.processQuestion(job);
      
      return {
        ...result,
        jobId: job.jobId,
        processedAt: new Date()
      };
    } catch (error) {
      logger.error(`Error processing QA job ${job.jobId}:`, error);
      throw error;
    }
  }

  private startProcessor(): void {
    setInterval(() => {
      this.processNextJob();
    }, 1000);
  }

  private async processNextJob(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    const nextJob = this.queue[0];
    if (!nextJob || this.processing.has(nextJob.jobId)) {
      return;
    }

    this.isProcessing = true;
    try {
      await this.processJob(nextJob.jobId);
    } catch (error) {
      logger.error(`Error processing job ${nextJob.jobId}:`, error);
    } finally {
      this.isProcessing = false;
    }
  }

  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: QAJobResult;
    error?: string;
  }> {
    // Check if job is currently processing
    if (this.processing.has(jobId)) {
      return { status: 'processing', progress: 50 };
    }

    // Check if job is in queue
    const queuedJob = this.queue.find(j => j.jobId === jobId);
    if (queuedJob) {
      return { status: 'queued', progress: 0 };
    }

    return { status: 'not_found', progress: 0 };
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    return {
      waiting: this.queue.length,
      active: this.processing.size,
      completed: 0, // We don't track completed jobs
      failed: 0     // We don't track failed jobs
    };
  }

  async checkUserRateLimit(userId: string, guildId: string): Promise<{
    allowed: boolean;
    remainingRequests: number;
    resetTime: number;
  }> {
    // Admin user ID - no rate limiting
    const adminUserId = '1101695671339335790';
    
    // Debug log to see what user ID we're checking
    console.log(`[RATE LIMIT DEBUG] Checking user: ${userId}, Admin: ${adminUserId}, Match: ${userId === adminUserId}`);
    
    if (userId === adminUserId) {
      console.log(`[RATE LIMIT DEBUG] Admin bypass activated for ${userId}`);
      return {
        allowed: true,
        remainingRequests: 999,
        resetTime: Date.now() + 60000
      };
    }

    // Reduced rate limiting - max 3 requests per minute per user (30% reduction from 5)
    const now = Date.now();
    const oneMinute = 60 * 1000;
    const maxRequests = 3;

    const userJobs = this.queue.filter(job => 
      job.userId === userId && 
      job.guildId === guildId &&
      (now - job.createdAt.getTime()) < oneMinute
    );

    const processingJobs = Array.from(this.processing.keys()).filter(jobId => {
      const job = this.queue.find(j => j.jobId === jobId);
      return job && job.userId === userId && job.guildId === guildId;
    });

    const totalJobs = userJobs.length + processingJobs.length;

    if (totalJobs >= maxRequests) {
      return {
        allowed: false,
        remainingRequests: 0,
        resetTime: now + oneMinute
      };
    }

    return {
      allowed: true,
      remainingRequests: maxRequests - totalJobs,
      resetTime: now + oneMinute
    };
  }
}