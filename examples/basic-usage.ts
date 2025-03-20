import { PollingServiceManager } from '../src';

// Example interfaces
interface DeliveryStatus {
  status: string;
  location: string;
  timestamp: string;
}

interface DeliveryDisplayData {
  formattedStatus: string;
  estimatedArrival: string;
  locationMap: string;
}

// Sample API client (mock)
const apiClient = {
  async initiateTracking(packageId: string): Promise<string> {
    console.log(`Initiating tracking for package ${packageId}`);
    // Simulate API call
    return `tracking-${packageId}`;
  },
  
  async checkDeliveryStatus(trackingId: string): Promise<{done: boolean, result?: DeliveryStatus}> {
    console.log(`Checking status for tracking ID ${trackingId}`);
    // Simulate API call - in a real scenario, this would check an external service
    
    // For demo purposes, randomly decide if the delivery is complete
    const isComplete = Math.random() > 0.7;
    
    if (isComplete) {
      return {
        done: true,
        result: {
          status: 'In Transit',
          location: 'Distribution Center',
          timestamp: new Date().toISOString()
        }
      };
    }
    
    return { done: false };
  },
  
  async prepareDeliveryData(status: DeliveryStatus): Promise<DeliveryDisplayData> {
    console.log(`Preparing UI data for status:`, status);
    // Simulate processing the status data for display
    return {
      formattedStatus: `Package is ${status.status.toLowerCase()}`,
      estimatedArrival: new Date(Date.now() + 86400000).toLocaleDateString(), // tomorrow
      locationMap: `https://maps.example.com?q=${encodeURIComponent(status.location)}`
    };
  }
};

// UI update function (mock)
function updateDeliveryUI(data: DeliveryDisplayData): void {
  console.log('Updating UI with delivery data:', data);
}

// Error handling function (mock)
function showError(message: string, error: Error): void {
  console.error(`${message}:`, error);
}

// Create an instance of the PollingServiceManager
const deliveryManager = new PollingServiceManager<string, DeliveryStatus, DeliveryDisplayData>({
  pollingInterval: 2000, // Check every 2 seconds for demo purposes
  maxRetryAttempts: 5    // Maximum 5 retries
});

// Start a tracking job
const packageId = 'PKG12345';
const jobId = deliveryManager.startJob(
  // Step 1: Initiate tracking
  () => apiClient.initiateTracking(packageId),
  
  // Step 2: Poll for delivery status
  (trackingId) => apiClient.checkDeliveryStatus(trackingId),
  
  // Step 3: Prepare UI data when status is available
  (deliveryStatus) => apiClient.prepareDeliveryData(deliveryStatus),
  
  // Success callback
  (displayData) => {
    updateDeliveryUI(displayData);
    console.log(`Job ${jobId} completed successfully!`);
  },
  
  // Error callback
  (error) => {
    showError(`Failed to track package ${packageId}`, error);
  }
);

console.log(`Started delivery tracking job with ID: ${jobId}`);

// Example of how to abort the job after some time (for demo purposes)
setTimeout(() => {
  console.log(`Job ${jobId} current state:`, deliveryManager.getJobState(jobId));
  
  // Uncomment to test abortion
  // if (deliveryManager.getJobState(jobId) === JobState.POLLING) {
  //   console.log(`Aborting job ${jobId}`);
  //   deliveryManager.abortJob(jobId);
  // }
}, 5000);