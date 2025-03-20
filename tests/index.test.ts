import { PollingServiceManager, JobState, PollingError, PollingAbortError } from '../src';

describe('PollingServiceManager', () => {
  // Helper function to wait for async operations
  const flushPromises = () => new Promise(resolve => setImmediate(resolve));

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate'
      ]
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // Basic setup test
  test('should create a new manager with default options', () => {
    const manager = new PollingServiceManager();
    expect(manager).toBeDefined();
  });

  // Configuration tests
  test('should honor custom polling interval configuration', async () => {
    const customInterval = 1000; // Reduced to make test faster
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: customInterval
    });

    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: false });
    const completeFn = jest.fn();

    manager.startJob(triggerFn, pollFn, completeFn);

    // Wait for the trigger function to complete
    await flushPromises();

    // Fast-forward time
    jest.advanceTimersByTime(customInterval);
    await flushPromises();

    expect(pollFn).toHaveBeenCalledTimes(1);
  }, 30000);

  test('should honor custom max retry attempts configuration', async () => {
    const maxRetries = 3;
    const manager = new PollingServiceManager<string, number, string>({
      maxRetryAttempts: maxRetries,
      pollingInterval: 100 // Use a smaller interval for testing
    });

    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: false });
    const completeFn = jest.fn();
    const onError = jest.fn();

    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);
    await flushPromises(); // Wait for trigger to complete

    // Fast-forward through maxRetries times (the initial call plus maxRetries-1 retries)
    for (let i = 0; i < maxRetries; i++) {
      jest.advanceTimersByTime(100);
      await flushPromises();
    }

    // The next call will exceed maxRetries and cause the error
    jest.advanceTimersByTime(100);
    await flushPromises();

    // Need extra flush for the error handling
    await flushPromises();

    // The poll function is called maxRetries+1 times:
    // 1. Initial call
    // 2,3,4. Retry attempts 1-3
    // After attempt #4, it exceeds maxRetries and throws an error
    expect(pollFn).toHaveBeenCalledTimes(maxRetries + 1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toContain('Exceeded maximum retry attempts');
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
  }, 30000);

  // Job lifecycle test
  test('should properly manage a job through its lifecycle', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100 // Use a smaller interval for testing
    });

    // Mock functions
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: true, result: 42 });
    const completeFn = jest.fn().mockResolvedValue('complete-result');
    const onComplete = jest.fn();
    const onError = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, onComplete, onError);

    // Wait for trigger to complete
    await flushPromises();

    // Verify initial state
    expect(manager.getJobState(jobId)).toBe(JobState.POLLING);
    expect(triggerFn).toHaveBeenCalledTimes(1);

    // First poll
    jest.advanceTimersByTime(100);
    await flushPromises();
    expect(pollFn).toHaveBeenCalledTimes(1);
    expect(pollFn).toHaveBeenCalledWith('trigger-result');

    // Second poll
    jest.advanceTimersByTime(100);
    await flushPromises();
    expect(pollFn).toHaveBeenCalledTimes(2);

    // Final poll - should trigger completion
    jest.advanceTimersByTime(100);
    await flushPromises();

    // Wait for completion to process
    await flushPromises();

    expect(pollFn).toHaveBeenCalledTimes(3);
    expect(completeFn).toHaveBeenCalledTimes(1);
    expect(completeFn).toHaveBeenCalledWith(42);
    expect(onComplete).toHaveBeenCalledWith('complete-result');
    expect(manager.getJobState(jobId)).toBe(JobState.COMPLETED);
    expect(onError).not.toHaveBeenCalled();
  }, 30000);

  // Job abort test
  test('should properly abort a job', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Mock functions
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: false });
    const completeFn = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn);

    // Wait for trigger to complete
    await flushPromises();

    // Verify initial state
    expect(manager.getJobState(jobId)).toBe(JobState.POLLING);

    // Abort the job
    manager.abortJob(jobId);
    expect(manager.getJobState(jobId)).toBe(JobState.ABORTED);

    // Run timers - polling should not continue
    jest.advanceTimersByTime(100);
    await flushPromises();
    expect(pollFn).not.toHaveBeenCalled();
  }, 30000);

  // Test abort all jobs
  test('should abort all jobs when requested', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Create several jobs
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: false });
    const completeFn = jest.fn();

    const jobId1 = manager.startJob(triggerFn, pollFn, completeFn);
    const jobId2 = manager.startJob(triggerFn, pollFn, completeFn);
    const jobId3 = manager.startJob(triggerFn, pollFn, completeFn);

    // Wait for triggers to complete
    await flushPromises();

    // Abort all jobs
    manager.abortAllJobs();

    // Verify all jobs are aborted
    expect(manager.getJobState(jobId1)).toBe(JobState.ABORTED);
    expect(manager.getJobState(jobId2)).toBe(JobState.ABORTED);
    expect(manager.getJobState(jobId3)).toBe(JobState.ABORTED);

    // Run timers - polling should not continue for any job
    jest.advanceTimersByTime(100);
    await flushPromises();
    expect(pollFn).not.toHaveBeenCalled();
  }, 30000);

  // Cleanup test
  test('should clean up job resources', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Create a job
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: false });
    const completeFn = jest.fn();

    const jobId = manager.startJob(triggerFn, pollFn, completeFn);
    await flushPromises();

    // Verify the job exists
    expect(manager.getJobState(jobId)).toBe(JobState.POLLING);

    // Clean up the job
    const result = manager.cleanupJob(jobId);
    expect(result).toBe(true);

    // Verify the job no longer exists
    expect(manager.getJobState(jobId)).toBeNull();
  }, 30000);

  // Test multiple concurrent jobs
  test('should manage multiple concurrent jobs independently', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Create job 1 - completes on second poll
    const triggerFn1 = jest.fn().mockResolvedValue('trigger-1');
    const pollFn1 = jest.fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: true, result: 1 });
    const completeFn1 = jest.fn().mockResolvedValue('complete-1');
    const onComplete1 = jest.fn();

    // Create job 2 - completes on third poll
    const triggerFn2 = jest.fn().mockResolvedValue('trigger-2');
    const pollFn2 = jest.fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: true, result: 2 });
    const completeFn2 = jest.fn().mockResolvedValue('complete-2');
    const onComplete2 = jest.fn();

    // Start both jobs
    const jobId1 = manager.startJob(triggerFn1, pollFn1, completeFn1, onComplete1);
    const jobId2 = manager.startJob(triggerFn2, pollFn2, completeFn2, onComplete2);

    // Wait for triggers to complete
    await flushPromises();

    // First poll cycle
    jest.advanceTimersByTime(100);
    await flushPromises();

    expect(pollFn1).toHaveBeenCalledTimes(1);
    expect(pollFn2).toHaveBeenCalledTimes(1);

    // Second poll cycle - job1 should complete
    jest.advanceTimersByTime(100);
    await flushPromises();
    await flushPromises(); // Additional flush for completion callback

    expect(pollFn1).toHaveBeenCalledTimes(2);
    expect(completeFn1).toHaveBeenCalledTimes(1);
    expect(onComplete1).toHaveBeenCalledTimes(1);
    expect(manager.getJobState(jobId1)).toBe(JobState.COMPLETED);

    expect(pollFn2).toHaveBeenCalledTimes(2);
    expect(manager.getJobState(jobId2)).toBe(JobState.POLLING);

    // Third poll cycle - job2 should complete
    jest.advanceTimersByTime(100);
    await flushPromises();
    await flushPromises(); // Additional flush for completion callback

    expect(pollFn2).toHaveBeenCalledTimes(3);
    expect(completeFn2).toHaveBeenCalledTimes(1);
    expect(onComplete2).toHaveBeenCalledTimes(1);
    expect(manager.getJobState(jobId2)).toBe(JobState.COMPLETED);
  }, 30000);

  // Error handling tests
  test('should handle errors in the trigger function', async () => {
    const manager = new PollingServiceManager<string, number, string>();

    // Mock functions with error in trigger
    const triggerError = new Error('Trigger failed');
    const triggerFn = jest.fn().mockRejectedValue(triggerError);
    const pollFn = jest.fn();
    const completeFn = jest.fn();
    const onError = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);

    // Wait for error to be processed
    await flushPromises();

    // Verify error handling
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
    expect(onError).toHaveBeenCalledWith(triggerError);
    expect(pollFn).not.toHaveBeenCalled();
    expect(completeFn).not.toHaveBeenCalled();
  }, 30000);

  test('should handle errors in the poll function', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Mock functions with error in poll
    const pollError = new Error('Polling failed');
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockRejectedValue(pollError);
    const completeFn = jest.fn();
    const onError = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll
    jest.advanceTimersByTime(100);
    await flushPromises();

    // Verify error handling
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
    expect(onError).toHaveBeenCalledWith(pollError);
    expect(completeFn).not.toHaveBeenCalled();
  }, 30000);

  test('should handle errors in the complete function', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Mock functions with error in complete
    const completeError = new Error('Completion failed');
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: true, result: 42 });
    const completeFn = jest.fn().mockRejectedValue(completeError);
    const onError = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll (which will trigger completion)
    jest.advanceTimersByTime(100);
    await flushPromises();
    await flushPromises(); // Additional flush for completion error

    // Verify error handling
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
    expect(onError).toHaveBeenCalledWith(completeError);
  }, 30000);

  test('should handle PollingAbortError specially', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Mock functions with abort error
    const abortError = new PollingAbortError('Resource not found, aborting');
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockRejectedValue(abortError);
    const completeFn = jest.fn();
    const onError = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll
    jest.advanceTimersByTime(100);
    await flushPromises();

    // Verify error handling
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
    expect(onError).toHaveBeenCalledWith(abortError);
    expect(completeFn).not.toHaveBeenCalled();
  }, 30000);

  // Edge cases
  test('should handle undefined poll result', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100,
      maxRetryAttempts: 2 // Use a small number to see retries quickly
    });

    // For this test, we need to create a scenario where the poll function returns
    // a result with done:true but WITH a result property that is undefined
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');

    // This pollfn always returns done:true with an explicit undefined result
    const pollFn = jest.fn().mockImplementation(() => {
      return Promise.resolve({ done: true, result: undefined });
    });

    const completeFn = jest.fn();
    const onError = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);

    // Wait for trigger to complete
    await flushPromises();

    // First poll - this should return done:true with result:undefined
    // and increment the retry count
    jest.advanceTimersByTime(100);
    await flushPromises();

    // Should call pollFn again after the polling interval
    jest.advanceTimersByTime(100);
    await flushPromises();

    // And one more time until we exceed maxRetryAttempts (which is 2)
    jest.advanceTimersByTime(100);
    await flushPromises();

    // At this point, the error should be triggered due to exceeding maxRetryAttempts
    expect(pollFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain('Exceeded maximum retry attempts');
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
  }, 30000);

  test('should handle errors in the onComplete callback', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Create a callback that throws
    const callbackError = new Error('Callback error');
    const onComplete = jest.fn().mockImplementation(() => {
      throw callbackError;
    });

    // Mock functions
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: true, result: 42 });
    const completeFn = jest.fn().mockResolvedValue('complete-result');

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, onComplete);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll (which will trigger completion)
    jest.advanceTimersByTime(100);
    await flushPromises();
    await flushPromises(); // Additional flush for completion

    // Job should still be marked as completed despite callback error
    expect(manager.getJobState(jobId)).toBe(JobState.COMPLETED);
    expect(onComplete).toHaveBeenCalled();
  }, 30000);

  test('should handle errors in the onError callback', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Create an error callback that throws
    const callbackError = new Error('Error callback error');
    const onError = jest.fn().mockImplementation(() => {
      throw callbackError;
    });

    // Mock functions with an error
    const pollError = new Error('Polling failed');
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockRejectedValue(pollError);
    const completeFn = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, undefined, onError);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll
    jest.advanceTimersByTime(100);
    await flushPromises();

    // Job should still be marked as failed despite error callback throwing
    expect(manager.getJobState(jobId)).toBe(JobState.FAILED);
    expect(onError).toHaveBeenCalled();
  }, 30000);

  // Utility methods tests
  test('getAllJobs should return correct job information', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Create some jobs in different states
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: false });
    const completeFn = jest.fn();

    const jobId1 = manager.startJob(triggerFn, pollFn, completeFn);
    const jobId2 = manager.startJob(triggerFn, pollFn, completeFn);

    // Wait for triggers to complete
    await flushPromises();

    // Abort one job
    manager.abortJob(jobId2);

    // Get all jobs
    const jobs = manager.getAllJobs();

    // Verify result
    expect(jobs).toHaveLength(2);
    expect(jobs.find(job => job.id === jobId1)?.state).toBe(JobState.POLLING);
    expect(jobs.find(job => job.id === jobId2)?.state).toBe(JobState.ABORTED);
  }, 30000);

  test('abortJob should return false for non-existent job', () => {
    const manager = new PollingServiceManager();
    const result = manager.abortJob('non-existent-job');
    expect(result).toBe(false);
  });

  test('cleanupJob should return false for non-existent job', () => {
    const manager = new PollingServiceManager();
    const result = manager.cleanupJob('non-existent-job');
    expect(result).toBe(false);
  });

  test('getJobState should return null for non-existent job', () => {
    const manager = new PollingServiceManager();
    const state = manager.getJobState('non-existent-job');
    expect(state).toBeNull();
  });

  // Additional test for immediate completion
  test('should handle immediate completion in the poll function', async () => {
    const manager = new PollingServiceManager<string, number, string>({
      pollingInterval: 100
    });

    // Mock functions with immediate completion
    const triggerFn = jest.fn().mockResolvedValue('trigger-result');
    const pollFn = jest.fn().mockResolvedValue({ done: true, result: 42 });
    const completeFn = jest.fn().mockResolvedValue('complete-result');
    const onComplete = jest.fn();

    // Start the job
    const jobId = manager.startJob(triggerFn, pollFn, completeFn, onComplete);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll
    jest.advanceTimersByTime(100);
    await flushPromises();
    await flushPromises(); // Additional flush for completion callback

    // Verify job completed after first poll
    expect(pollFn).toHaveBeenCalledTimes(1);
    expect(completeFn).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(manager.getJobState(jobId)).toBe(JobState.COMPLETED);
  }, 30000);

  // Test handling of type conversion
  test('should properly handle different generic types', async () => {
    // Define different types
    interface InputType {
      id: string;
      timestamp: number;
    }

    interface ResultType {
      status: string;
      data: {
        value: number;
        unit: string;
      };
    }

    interface OutputType {
      displayValue: string;
      isValid: boolean;
    }

    const manager = new PollingServiceManager<InputType, ResultType, OutputType>({
      pollingInterval: 100
    });

    // Create typed mock functions
    const input: InputType = { id: 'test-id', timestamp: Date.now() };
    const result: ResultType = {
      status: 'success',
      data: { value: 42, unit: 'kg' } 
    };
    const output: OutputType = {
      displayValue: '42 kg',
      isValid: true
    };

    const triggerFn = jest.fn().mockResolvedValue(input);
    const pollFn = jest.fn().mockResolvedValue({ done: true, result });
    const completeFn = jest.fn().mockResolvedValue(output);
    const onComplete = jest.fn();

    // Start the job
    manager.startJob(triggerFn, pollFn, completeFn, onComplete);

    // Wait for trigger to complete
    await flushPromises();

    // Run first poll
    jest.advanceTimersByTime(100);
    await flushPromises();
    await flushPromises(); // Additional flush for completion

    // Verify type handling
    expect(pollFn).toHaveBeenCalledWith(input);
    expect(completeFn).toHaveBeenCalledWith(result);
    expect(onComplete).toHaveBeenCalledWith(output);
  }, 30000);
});