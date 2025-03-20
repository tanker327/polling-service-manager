# PollingServiceManager

A TypeScript utility for managing asynchronous operations that require polling. It handles scenarios where:

1. An initial service is triggered
2. The status of the service must be checked repeatedly until completion
3. The result from the completed operation is used to trigger a final operation

This pattern is common in scenarios like file processing, long-running calculations, or external service integrations where results are not immediately available.

## Installation

```bash
npm install polling-service-manager
```

## Usage

### Basic Example

```typescript
import { PollingServiceManager } from 'polling-service-manager';

// Create a manager for tracking order status
const orderStatusManager = new PollingServiceManager<string, OrderDetails, DisplayData>();

// Start a job to track an order
const jobId = orderStatusManager.startJob(
  // Step 1: Trigger the order check
  async () => {
    const response = await api.initiateOrderCheck(orderId);
    return response.checkId;
  },
  
  // Step 2: Poll until the check is complete
  async (checkId) => {
    const status = await api.getOrderCheckStatus(checkId);
    return {
      done: status.isComplete,
      result: status.isComplete ? status.orderDetails : undefined
    };
  },
  
  // Step 3: Process the final results
  async (orderDetails) => {
    return await api.prepareOrderDisplayData(orderDetails);
  },
  
  // Success callback
  (displayData) => {
    updateOrderStatusUI(displayData);
  },
  
  // Error callback
  (error) => {
    showErrorNotification("Failed to load order status", error);
  }
);

// Later, if needed
orderStatusManager.abortJob(jobId);
```

### Multiple Manager Instances

You can create different manager instances for different domains:

```typescript
// Delivery status manager
const deliveryManager = new PollingServiceManager();

// Order processing manager
const orderManager = new PollingServiceManager({
  pollingInterval: 10000, // Check less frequently
});

// Each can handle multiple jobs of their respective domains
```

### Custom Error Handling

The library provides custom error classes for specific scenarios:

```typescript
import { PollingError, PollingAbortError } from 'polling-service-manager';

// In your polling function
async function pollStatus(id: string) {
  const response = await fetch(`/api/status/${id}`);
  
  if (response.status === 404) {
    // Signal that this job should be aborted
    throw new PollingAbortError("Resource not found, aborting");
  }
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  const data = await response.json();
  return {
    done: data.status === 'complete',
    result: data.status === 'complete' ? data.result : undefined
  };
}
```

## API Reference

### PollingServiceManager

```typescript
class PollingServiceManager<T, U, V> {
  constructor(options?: PollingServiceManagerOptions);
  
  startJob(
    triggerFn: TriggerFn<T>, 
    pollFn: PollFn<T, U>, 
    completeFn: CompleteFn<U, V>,
    onComplete?: (result: V) => void,
    onError?: (error: Error) => void
  ): string;
  
  abortJob(jobId: string): boolean;
  
  abortAllJobs(): void;
  
  getJobState(jobId: string): JobState | null;
  
  cleanupJob(jobId: string): boolean;
  
  getAllJobs(): Array<{ id: string, state: JobState }>;
}
```

### Options

```typescript
interface PollingServiceManagerOptions {
  pollingInterval?: number;       // Default: 5000ms (5 seconds)
  maxRetryAttempts?: number;      // Default: 10
  logLevel?: string;              // Default: 'info'
}
```

### Job States

```typescript
enum JobState {
  PENDING = 'PENDING',
  POLLING = 'POLLING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ABORTED = 'ABORTED'
}
```

### Function Types

```typescript
type TriggerFn<T> = () => Promise<T>;
type PollFn<T, U> = (triggerResult: T) => Promise<{done: boolean, result?: U}>;
type CompleteFn<U, V> = (pollResult: U) => Promise<V>;
```

## License

MIT