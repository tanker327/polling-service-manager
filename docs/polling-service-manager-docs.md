# PollingServiceManager Documentation

## Overview

The `PollingServiceManager` is a TypeScript utility designed to manage asynchronous operations that require polling. It handles scenarios where:

1. An initial service is triggered
2. The status of the service must be checked repeatedly until completion
3. The result from the completed operation is used to trigger a final operation

This pattern is common in scenarios like file processing, long-running calculations, or external service integrations where results are not immediately available.

## Core Concepts

### Job Lifecycle

Each job managed by the `PollingServiceManager` follows a three-step process:

1. **Trigger**: Initiates the service/operation
2. **Poll**: Repeatedly checks the status until completion
3. **Complete**: Processes the final result when polling is complete

### Job States

Jobs can exist in the following states:

- **PENDING**: Job has been created but not yet started
- **POLLING**: Job has been triggered and is being polled
- **COMPLETED**: Job has successfully completed all steps
- **FAILED**: Job has encountered an error that prevented completion
- **ABORTED**: Job was manually stopped by the user

### Job Type Flow

The generic type flow for a job follows this pattern:

```
TriggerFn<T> → PollFn<T, U> → CompleteFn<U, V>
```

Where:
- `T` is the result type of the trigger function
- `U` is the result type of the polling function 
- `V` is the final result type after completion

## Design Decisions

### Multiple Manager Instances

- The `PollingServiceManager` is **not** a singleton
- Different manager instances can be created for different domains (e.g., delivery status, order status)
- Each manager maintains its own list of jobs

### Error Handling

- Different error handling strategies for different error types
- Retryable vs. non-retryable errors can be distinguished
- Users can throw specific errors to signal the polling manager to take appropriate action
- HTTP 404 errors may indicate the resource doesn't exist, requiring special handling

### Control Operations

- Jobs can be aborted individually by job ID
- All jobs in a manager can be aborted simultaneously
- (Future) Pause/resume functionality may be added

### Logging

- Integration with the log-level library for consistent logging
- Job lifecycle events are logged for monitoring and debugging
- Error conditions are appropriately logged with context

### Configuration

- Configurable polling intervals (default provided)
- Configurable maximum retry attempts (default provided)
- No job priority system - all jobs have equal priority
- No concurrency limits
- No timeout enforcement
- No job dependencies

## API Reference

### PollingServiceManager Class

```typescript
class PollingServiceManager<T, U, V> {
  // Creates a new manager instance
  constructor(options?: PollingServiceManagerOptions);
  
  // Adds a new job to the manager and starts it immediately
  startJob(
    triggerFn: TriggerFn<T>, 
    pollFn: PollFn<T, U>, 
    completeFn: CompleteFn<U, V>,
    onComplete?: (result: V) => void,
    onError?: (error: Error) => void
  ): string;
  
  // Aborts a specific job by ID
  abortJob(jobId: string): boolean;
  
  // Aborts all jobs managed by this instance
  abortAllJobs(): void;
  
  // Returns the current state of a job
  getJobState(jobId: string): JobState | null;
  
  // Optional: Cleans up resources for a job
  cleanupJob(jobId: string): boolean;
}
```

### Type Definitions

```typescript
type TriggerFn<T> = () => Promise<T>;
type PollFn<T, U> = (triggerResult: T) => Promise<{done: boolean, result?: U}>;
type CompleteFn<U, V> = (pollResult: U) => Promise<V>;

enum JobState {
  PENDING = 'PENDING',
  POLLING = 'POLLING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABORTED = 'ABORTED'
}

interface PollingServiceManagerOptions {
  pollingInterval?: number;       // Default: 5000ms (5 seconds)
  maxRetryAttempts?: number;      // Default: 10
  logLevel?: string;              // Default: 'info'
}
```

## Usage Examples

### Basic Usage

```typescript
// Create a manager for tracking order status
const orderStatusManager = new PollingServiceManager();

// Define the job functions
const triggerOrderCheck = async () => {
  const response = await api.initiateOrderCheck(orderId);
  return response.checkId;
};

const pollOrderStatus = async (checkId: string) => {
  const status = await api.getOrderCheckStatus(checkId);
  return {
    done: status.isComplete,
    result: status.isComplete ? status.orderDetails : undefined
  };
};

const processOrderDetails = async (orderDetails: OrderDetails) => {
  return await api.prepareOrderDisplayData(orderDetails);
};

// Start the job
const jobId = orderStatusManager.startJob(
  triggerOrderCheck,
  pollOrderStatus,
  processOrderDetails,
  (displayData) => {
    // Update UI with the display data
    updateOrderStatusUI(displayData);
  },
  (error) => {
    // Handle any errors
    showErrorNotification("Failed to load order status", error);
  }
);

// Later, if needed
orderStatusManager.abortJob(jobId);
```

### Multiple Job Types

```typescript
// Delivery status manager
const deliveryManager = new PollingServiceManager();

// Order processing manager
const orderManager = new PollingServiceManager({
  pollingInterval: 10000, // Check less frequently
});

// Each can handle multiple jobs of their respective domains
```

## Error Handling Strategy

### Error Types

1. **Retryable Errors**: Temporary issues that may resolve on retry
   - Network timeouts
   - Rate limiting responses
   - Temporary service unavailability

2. **Non-Retryable Errors**: Permanent issues that will not resolve with retries
   - Authentication failures
   - Resource not found (404)
   - Invalid input data

### Handling Mechanisms

- Job-specific error handlers can be provided when starting a job
- Special error types can be thrown to signal specific handling:
  ```typescript
  throw new PollingAbortError("Resource not found, aborting");
  ```
- Error information is passed to error callbacks with context

## Future Considerations

The following features are not currently implemented but may be considered for future versions:

1. **Resume Functionality**: Ability to pause and resume jobs
2. **Job Dependencies**: Support for chaining jobs where one depends on another
3. **Priority System**: Allow certain jobs to have higher polling priority
4. **Concurrency Limits**: Restrict the number of simultaneous polling operations
5. **Timeout Handling**: Automatically fail jobs that exceed time limits
6. **Event-Based Monitoring**: Provide an event system alongside callbacks
7. **Persistence**: Optional persistence of job state for recovery
