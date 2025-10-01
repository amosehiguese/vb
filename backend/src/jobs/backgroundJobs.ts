import { sweepService } from '../services/SweepService';
import { logger } from '../config/logger';

let sweepMonitoringInterval: NodeJS.Timeout | null = null;

export const startSweepMonitoringJob = (): void => {
  if (sweepMonitoringInterval) {
    logger.warn('Sweep monitoring job already running');
    return;
  }

  // Run every 5 minutes
  const intervalMs = 5 * 60 * 1000;

  logger.info('Starting sweep monitoring background job', {
    intervalMinutes: 5
  });

  // Run immediately on startup
  sweepService.monitorStrandedWallets().catch(error => {
    logger.error('Initial sweep monitoring failed', { error });
  });

  // Then run every 5 minutes
  sweepMonitoringInterval = setInterval(async () => {
    try {
      await sweepService.monitorStrandedWallets();
    } catch (error) {
      logger.error('Sweep monitoring job error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, intervalMs);

  logger.info('Sweep monitoring job started successfully');
}

export const stopSweepMonitoringJob = (): void => {
  if (sweepMonitoringInterval) {
    clearInterval(sweepMonitoringInterval);
    sweepMonitoringInterval = null;
    logger.info('Sweep monitoring job stopped');
  }
}