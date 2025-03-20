import * as log from 'loglevel';

// Type definitions for the job functions
export type TriggerFn<T> = () => Promise<T>;
export type PollFn<T, U> = (triggerResult: T) => Promise<{done: boolean, result?: U}>;
export type CompleteFn<U, V> = (pollResult: U) => Promise<V>;

// Job state enum
export enum JobState {
  PENDING = 'PENDING',
  POLLING = 'POLLING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABORTED = 'ABORTED'
}

// Options for the PollingServiceManager
export interface PollingServiceManagerOptions {
  pollingInterval?: number;       // Default: 5000ms (5 seconds)
  maxRetryAttempts?: number;      // Default: 10
  logLevel?: string;              // Default: 'info'
}

// Internal job structure
interface Job<T, U, V> {
  id: string;
  state: JobState;
  triggerFn: TriggerFn<T>;
  pollFn: PollFn<T, U>;
  completeFn: CompleteFn<U, V>;
  onComplete?: (result: V) => void;
  onError?: (error: Error) => void;
  triggerResult?: T;
  pollResult?: U;
  finalResult?: V;
  retryCount: number;
  error?: Error;
  timerId?: NodeJS.Timeout;
}

// Custom error classes
export class PollingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PollingError';
  }
}

export class PollingAbortError extends PollingError {
  constructor(message: string) {
    super(message);
    this.name = 'PollingAbortError';
  }
}

/**
 * The PollingServiceManager handles asynchronous operations that require polling.
 * It manages the lifecycle of jobs through trigger, poll, and completion phases.
 */
export class PollingServiceManager<T, U, V> {
  private jobs: Map<string, Job<T, U, V>> = new Map();
  private options: Required<PollingServiceManagerOptions>;
  private logger: log.Logger;

  /**
   * Creates a new PollingServiceManager instance.
   * @param options Optional configuration options
   */
  constructor(options?: PollingServiceManagerOptions) {
    // Set default options
    this.options = {
      pollingInterval: options?.pollingInterval ?? 5000,
      maxRetryAttempts: options?.maxRetryAttempts ?? 10,
      logLevel: options?.logLevel ?? 'info'
    };
    
    // Initialize logger
    this.logger = log.getLogger('PollingServiceManager');
    this.logger.setLevel(this.options.logLevel as log.LogLevelDesc);
  }

  /**
   * Adds a new job to the manager and starts it immediately
   * @param triggerFn Function to trigger the initial service
   * @param pollFn Function to check the status until completion
   * @param completeFn Function to process the final result
   * @param onComplete Optional callback for successful completion
   * @param onError Optional callback for error handling
   * @returns A unique job ID
   */
  startJob(
    triggerFn: TriggerFn<T>,
    pollFn: PollFn<T, U>,
    completeFn: CompleteFn<U, V>,
    onComplete?: (result: V) => void,
    onError?: (error: Error) => void
  ): string {
    // Generate a unique job ID
    const jobId = this.generateJobId();
    
    // Create the job object
    const job: Job<T, U, V> = {
      id: jobId,
      state: JobState.PENDING,
      triggerFn,
      pollFn,
      completeFn,
      onComplete,
      onError,
      retryCount: 0,
    };
    
    // Store the job
    this.jobs.set(jobId, job);
    
    // Log job creation
    this.logger.info(`Job ${jobId} created and starting`);
    
    // Start the job process
    this.executeJobTrigger(jobId);
    
    return jobId;
  }

  /**
   * Aborts a specific job by ID
   * @param jobId The ID of the job to abort
   * @returns true if the job was found and aborted, false otherwise
   */
  abortJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      this.logger.warn(`Attempted to abort non-existent job ${jobId}`);
      return false;
    }
    
    // Clear any active timer
    if (job.timerId) {
      clearTimeout(job.timerId);
    }
    
    // Update job state
    job.state = JobState.ABORTED;
    this.logger.info(`Job ${jobId} aborted`);
    
    return true;
  }

  /**
   * Aborts all jobs managed by this instance
   */
  abortAllJobs(): void {
    this.logger.info('Aborting all jobs');
    
    for (const jobId of this.jobs.keys()) {
      this.abortJob(jobId);
    }
  }

  /**
   * Returns the current state of a job
   * @param jobId The ID of the job to check
   * @returns The job state, or null if the job doesn't exist
   */
  getJobState(jobId: string): JobState | null {
    const job = this.jobs.get(jobId);
    return job ? job.state : null;
  }

  /**
   * Cleans up resources for a job
   * @param jobId The ID of the job to clean up
   * @returns true if the job was found and cleaned up, false otherwise
   */
  cleanupJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      return false;
    }
    
    // Ensure the job is not active
    if (job.state === JobState.POLLING) {
      this.abortJob(jobId);
    }
    
    // Remove the job from our records
    this.jobs.delete(jobId);
    this.logger.info(`Job ${jobId} cleaned up`);
    
    return true;
  }

  /**
   * Returns information about all jobs
   * @returns An array of job information objects
   */
  getAllJobs(): Array<{ id: string, state: JobState }> {
    const jobInfos: Array<{ id: string, state: JobState }> = [];
    
    for (const job of this.jobs.values()) {
      jobInfos.push({
        id: job.id,
        state: job.state
      });
    }
    
    return jobInfos;
  }

  /**
   * Generates a unique job ID
   * @private
   * @returns A unique job ID string
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Executes the trigger function for a job
   * @private
   * @param jobId The ID of the job to execute
   */
  private async executeJobTrigger(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      return;
    }
    
    try {
      // Update job state
      job.state = JobState.POLLING;
      this.logger.info(`Job ${jobId} triggering`);
      
      // Execute the trigger function
      const triggerResult = await job.triggerFn();
      job.triggerResult = triggerResult;
      
      this.logger.info(`Job ${jobId} triggered successfully, starting polling`);
      
      // Start polling
      this.executeJobPolling(jobId);
    } catch (error) {
      this.handleJobError(jobId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Executes the polling function for a job
   * @private
   * @param jobId The ID of the job to poll
   */
  private executeJobPolling(jobId: string): void {
    const job = this.jobs.get(jobId);
    
    if (!job || job.state !== JobState.POLLING) {
      return;
    }
    
    // Set up the polling timer
    job.timerId = setTimeout(async () => {
      try {
        if (!job.triggerResult) {
          throw new PollingError('Trigger result is undefined');
        }
        
        // Execute the poll function
        const pollResponse = await job.pollFn(job.triggerResult);
        
        if (pollResponse.done && pollResponse.result !== undefined) {
          // Polling is complete, store the result
          job.pollResult = pollResponse.result;
          this.logger.info(`Job ${jobId} polling completed successfully`);
          
          // Move to completion step
          this.executeJobCompletion(jobId);
        } else {
          // Not done yet, increment retry count
          job.retryCount++;
          
          if (job.retryCount > this.options.maxRetryAttempts) {
            throw new PollingError(`Exceeded maximum retry attempts (${this.options.maxRetryAttempts})`);
          }
          
          this.logger.debug(`Job ${jobId} still polling (attempt ${job.retryCount}/${this.options.maxRetryAttempts})`);
          
          // Continue polling
          this.executeJobPolling(jobId);
        }
      } catch (error) {
        this.handleJobError(jobId, error instanceof Error ? error : new Error(String(error)));
      }
    }, this.options.pollingInterval);
  }

  /**
   * Executes the completion function for a job
   * @private
   * @param jobId The ID of the job to complete
   */
  private async executeJobCompletion(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      return;
    }
    
    try {
      if (!job.pollResult) {
        throw new PollingError('Poll result is undefined');
      }
      
      // Execute the completion function
      const finalResult = await job.completeFn(job.pollResult);
      job.finalResult = finalResult;
      
      // Update job state
      job.state = JobState.COMPLETED;
      this.logger.info(`Job ${jobId} completed successfully`);
      
      // Call the onComplete callback if provided
      if (job.onComplete) {
        try {
          job.onComplete(finalResult);
        } catch (callbackError) {
          this.logger.error(`Error in onComplete callback for job ${jobId}:`, callbackError);
        }
      }
    } catch (error) {
      this.handleJobError(jobId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handles errors for a job
   * @private
   * @param jobId The ID of the job that encountered an error
   * @param error The error that occurred
   */
  private handleJobError(jobId: string, error: Error): void {
    const job = this.jobs.get(jobId);
    
    if (!job) {
      return;
    }
    
    // Update job state and store the error
    job.state = JobState.FAILED;
    job.error = error;
    
    this.logger.error(`Job ${jobId} failed:`, error);
    
    // Call the onError callback if provided
    if (job.onError) {
      try {
        job.onError(error);
      } catch (callbackError) {
        this.logger.error(`Error in onError callback for job ${jobId}:`, callbackError);
      }
    }
    
    // If this is a special abort error, we don't need to do anything else
    if (error instanceof PollingAbortError) {
      return;
    }
    
    // Here we could implement additional error handling logic
    // For example, we might want to retry certain types of errors
  }
}