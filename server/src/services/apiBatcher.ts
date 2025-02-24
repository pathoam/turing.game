export class APIBatcher {
  private queue: Map<string, {
    prompt: string,
    resolve: (response: string) => void,
    reject: (error: Error) => void
  }[]> = new Map();
  
  private batchTimeout: number = 100; // ms
  private maxBatchSize: number = 5;

  async queuePrompt(modelId: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.queue.has(modelId)) {
        this.queue.set(modelId, []);
        this.scheduleBatch(modelId);
      }
      
      this.queue.get(modelId)!.push({
        prompt,
        resolve,
        reject
      });
    });
  }

  private scheduleBatch(modelId: string) {
    setTimeout(() => {
      this.processBatch(modelId);
    }, this.batchTimeout);
  }

  private async processBatch(modelId: string) {
    const batch = this.queue.get(modelId) || [];
    this.queue.delete(modelId);

    if (batch.length === 0) return;

    try {
      // Process batch of prompts together
      const responses = await this.makeAPICall(modelId, batch.map(b => b.prompt));
      
      // Resolve individual promises
      batch.forEach((item, index) => {
        item.resolve(responses[index]);
      });
    } catch (error) {
      batch.forEach(item => {
        item.reject(error as Error);
      });
    }
  }

  private async makeAPICall(modelId: string, prompts: string[]): Promise<string[]> {
    // Implement actual API call logic here
    return [];
  }
} 