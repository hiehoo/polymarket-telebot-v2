import { EventEmitter } from 'events';
import { redisClient } from '@/config/redis';
import logger from '@/utils/logger';
import { NotificationData } from '@/types/telegram';

export interface MonitoringConfig {
  // Redis keys
  metricsKey: string;
  alertsKey: string;
  healthKey: string;
  performanceKey: string;

  // Monitoring intervals
  metricsCollectionInterval: number; // seconds
  healthCheckInterval: number; // seconds
  performanceAnalysisInterval: number; // seconds
  alertEvaluationInterval: number; // seconds

  // Alert thresholds
  alertThresholds: {
    deliveryRate: number; // percentage
    errorRate: number; // percentage
    queueDepth: number;
    processingLatency: number; // milliseconds
    memoryUsage: number; // percentage
    cpuUsage: number; // percentage
  };

  // Performance baselines
  performanceBaselines: {
    averageDeliveryTime: number; // milliseconds
    throughput: number; // notifications per minute
    successRate: number; // percentage
    queueLatency: number; // milliseconds
  };

  // Monitoring settings
  enableRealTimeMonitoring: boolean;
  enablePerformanceAlerts: boolean;
  enableHealthChecks: boolean;
  enableDetailedMetrics: boolean;

  // Data retention
  metricsRetentionDays: number;
  alertsRetentionDays: number;
  performanceHistoryDays: number;
}

export interface PerformanceMetrics {
  // Real-time metrics
  currentMetrics: {
    notificationsPerSecond: number;
    notificationsPerMinute: number;
    averageDeliveryTime: number;
    successRate: number;
    errorRate: number;
    queueDepth: number;
    processingLatency: number;
    queueLatency: number;

    // System metrics
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
    activeWorkers: number;
  };

  // Historical metrics
  hourlyMetrics: Array<{
    timestamp: Date;
    notificationsProcessed: number;
    averageDeliveryTime: number;
    successRate: number;
    errorRate: number;
    peakThroughput: number;
    lowThroughput: number;
  }>;

  // Performance trends
  trends: {
    deliveryTimeTrend: 'improving' | 'degrading' | 'stable';
    throughputTrend: 'increasing' | 'decreasing' | 'stable';
    errorRateTrend: 'improving' | 'worsening' | 'stable';
    performanceScore: number; // 0-100
  };

  // Bottleneck analysis
  bottlenecks: Array<{
    type: 'queue' | 'processing' | 'delivery' | 'external_api' | 'database';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    impact: string;
    recommendation: string;
    detectedAt: Date;
    metrics: Record<string, number>;
  }>;

  // Capacity planning
  capacityMetrics: {
    maxThroughput: number;
    currentCapacity: number; // percentage
    projectedCapacity: number; // based on trends
    recommendedScaling: {
      workers: number;
      queueSize: number;
      memory: number;
      timeframe: string;
    };
  };
}

export interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical' | 'down';
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message?: string;
    lastChecked: Date;
    responseTime?: number;
    details?: any;
  }>;

  overallScore: number; // 0-100
  uptime: number; // percentage
  lastRestart: Date;
  activeIncidents: number;

  dependencies: Array<{
    name: string;
    status: 'connected' | 'disconnected' | 'degraded';
    lastChecked: Date;
    responseTime?: number;
    errorRate?: number;
  }>;
}

export interface MonitoringAlert {
  id: string;
  type: 'performance' | 'health' | 'capacity' | 'error_spike' | 'anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  metrics: Record<string, any>;
  threshold: number;
  currentValue: number;
  createdAt: Date;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolved: boolean;
  resolvedAt?: Date;
  actions: Array<{
    type: 'auto' | 'manual';
    description: string;
    executed: boolean;
    executedAt?: Date;
    result?: string;
  }>;
}

export interface SystemOverview {
  status: HealthStatus;
  metrics: PerformanceMetrics;
  alerts: MonitoringAlert[];
  summary: {
    totalNotifications: number;
    successRate: number;
    averageDeliveryTime: number;
    activeUsers: number;
    queueDepth: number;
    systemHealth: number; // 0-100
  };
}

export class NotificationMonitoringAnalytics extends EventEmitter {
  private config: MonitoringConfig;

  // Monitoring state
  private isMonitoring = false;
  private monitoringTimers: Map<string, NodeJS.Timeout> = new Map();

  // Metrics collection
  private currentMetrics: PerformanceMetrics['currentMetrics'] = {
    notificationsPerSecond: 0,
    notificationsPerMinute: 0,
    averageDeliveryTime: 0,
    successRate: 0,
    errorRate: 0,
    queueDepth: 0,
    processingLatency: 0,
    queueLatency: 0,
    memoryUsage: 0,
    cpuUsage: 0,
    activeConnections: 0,
    activeWorkers: 0
  };

  // Historical data
  private hourlyMetrics: PerformanceMetrics['hourlyMetrics'] = [];
  private recentNotifications: Array<{
    timestamp: Date;
    processingTime: number;
    success: boolean;
  }> = [];

  // Active alerts
  private activeAlerts: Map<string, MonitoringAlert> = new Map();

  // Health checks
  private healthChecks: HealthStatus['checks'] = [];

  constructor(config: Partial<MonitoringConfig> = {}) {
    super();

    this.config = {
      metricsKey: 'monitoring:metrics',
      alertsKey: 'monitoring:alerts',
      healthKey: 'monitoring:health',
      performanceKey: 'monitoring:performance',

      metricsCollectionInterval: 30, // 30 seconds
      healthCheckInterval: 60, // 1 minute
      performanceAnalysisInterval: 300, // 5 minutes
      alertEvaluationInterval: 60, // 1 minute

      alertThresholds: {
        deliveryRate: 95, // 95%
        errorRate: 5, // 5%
        queueDepth: 1000,
        processingLatency: 5000, // 5 seconds
        memoryUsage: 80, // 80%
        cpuUsage: 75 // 75%
      },

      performanceBaselines: {
        averageDeliveryTime: 200, // 200ms
        throughput: 100, // 100 per minute
        successRate: 98, // 98%
        queueLatency: 50 // 50ms
      },

      enableRealTimeMonitoring: true,
      enablePerformanceAlerts: true,
      enableHealthChecks: true,
      enableDetailedMetrics: true,

      metricsRetentionDays: 7,
      alertsRetentionDays: 30,
      performanceHistoryDays: 90,

      ...config
    };

    this.initializeHealthChecks();
    this.loadExistingData();
  }

  private async initializeHealthChecks(): Promise<void> {
    this.healthChecks = [
      {
        name: 'redis_connection',
        status: 'pass',
        lastChecked: new Date(),
        responseTime: 0,
        details: { host: process.env.REDIS_HOST || 'localhost' }
      },
      {
        name: 'telegram_api',
        status: 'pass',
        lastChecked: new Date(),
        responseTime: 0,
        details: { endpoint: 'api.telegram.org' }
      },
      {
        name: 'queue_processing',
        status: 'pass',
        lastChecked: new Date(),
        details: { status: 'active' }
      },
      {
        name: 'notification_delivery',
        status: 'pass',
        lastChecked: new Date(),
        details: { delivery_rate: 100 }
      },
      {
        name: 'memory_usage',
        status: 'pass',
        lastChecked: new Date(),
        details: { usage_percentage: 0 }
      },
      {
        name: 'cpu_usage',
        status: 'pass',
        lastChecked: new Date(),
        details: { usage_percentage: 0 }
      }
    ];
  }

  private async loadExistingData(): Promise<void> {
    try {
      // Load existing alerts
      const existingAlerts = await redisClient.hgetall(this.config.alertsKey);
      for (const [alertId, alertData] of Object.entries(existingAlerts)) {
        const alert: MonitoringAlert = JSON.parse(alertData);
        if (!alert.resolved) {
          this.activeAlerts.set(alertId, alert);
        }
      }

      // Load recent performance data
      const performanceData = await redisClient.get(this.config.performanceKey);
      if (performanceData) {
        const data = JSON.parse(performanceData);
        this.hourlyMetrics = data.hourlyMetrics || [];
        this.recentNotifications = data.recentNotifications || [];
      }

      logger.info(`Monitoring system initialized with ${this.activeAlerts.size} active alerts`);

    } catch (error) {
      logger.error('Error loading existing monitoring data:', error);
    }
  }

  startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('Monitoring already started');
      return;
    }

    this.isMonitoring = true;

    // Start metrics collection
    if (this.config.enableRealTimeMonitoring) {
      const metricsTimer = setInterval(() => {
        this.collectMetrics().catch(error => {
          logger.error('Error collecting metrics:', error);
        });
      }, this.config.metricsCollectionInterval * 1000);

      this.monitoringTimers.set('metrics', metricsTimer);
    }

    // Start health checks
    if (this.config.enableHealthChecks) {
      const healthTimer = setInterval(() => {
        this.performHealthChecks().catch(error => {
          logger.error('Error performing health checks:', error);
        });
      }, this.config.healthCheckInterval * 1000);

      this.monitoringTimers.set('health', healthTimer);
    }

    // Start performance analysis
    const performanceTimer = setInterval(() => {
      this.analyzePerformance().catch(error => {
        logger.error('Error analyzing performance:', error);
      });
    }, this.config.performanceAnalysisInterval * 1000);

    this.monitoringTimers.set('performance', performanceTimer);

    // Start alert evaluation
    if (this.config.enablePerformanceAlerts) {
      const alertTimer = setInterval(() => {
        this.evaluateAlerts().catch(error => {
          logger.error('Error evaluating alerts:', error);
        });
      }, this.config.alertEvaluationInterval * 1000);

      this.monitoringTimers.set('alerts', alertTimer);
    }

    logger.info('Notification monitoring system started');
    this.emit('monitoring:started');
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    // Clear all timers
    for (const timer of this.monitoringTimers.values()) {
      clearInterval(timer);
    }
    this.monitoringTimers.clear();

    logger.info('Notification monitoring system stopped');
    this.emit('monitoring:stopped');
  }

  private async collectMetrics(): Promise<void> {
    try {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      const oneHourAgo = now - 3600000;

      // Count recent notifications
      const recentCount = this.recentNotifications.filter(
        n => n.timestamp.getTime() > oneMinuteAgo
      ).length;

      const hourlyCount = this.recentNotifications.filter(
        n => n.timestamp.getTime() > oneHourAgo
      ).length;

      // Calculate metrics
      this.currentMetrics.notificationsPerMinute = recentCount;
      this.currentMetrics.notificationsPerSecond = recentCount / 60;

      const recentSuccessful = this.recentNotifications.filter(
        n => n.timestamp.getTime() > oneMinuteAgo && n.success
      ).length;

      this.currentMetrics.successRate = recentCount > 0 ? (recentSuccessful / recentCount) * 100 : 0;
      this.currentMetrics.errorRate = recentCount > 0 ? ((recentCount - recentSuccessful) / recentCount) * 100 : 0;

      // Calculate average processing times
      const recentProcessingTimes = this.recentNotifications
        .filter(n => n.timestamp.getTime() > oneMinuteAgo)
        .map(n => n.processingTime);

      this.currentMetrics.averageDeliveryTime = recentProcessingTimes.length > 0
        ? recentProcessingTimes.reduce((sum, time) => sum + time, 0) / recentProcessingTimes.length
        : 0;

      // Get system metrics
      const systemMetrics = await this.getSystemMetrics();
      this.currentMetrics.memoryUsage = systemMetrics.memoryUsage;
      this.currentMetrics.cpuUsage = systemMetrics.cpuUsage;

      // Get queue metrics
      const queueMetrics = await this.getQueueMetrics();
      this.currentMetrics.queueDepth = queueMetrics.depth;
      this.currentMetrics.queueLatency = queueMetrics.latency;

      // Store in Redis
      await redisClient.hset(
        this.config.metricsKey,
        'current',
        JSON.stringify(this.currentMetrics)
      );

      // Cleanup old notifications
      const oneHourAgoDate = new Date(oneHourAgo);
      this.recentNotifications = this.recentNotifications.filter(
        n => n.timestamp > oneHourAgoDate
      );

      this.emit('metrics:collected', this.currentMetrics);

    } catch (error) {
      logger.error('Error collecting metrics:', error);
    }
  }

  private async getSystemMetrics(): Promise<{
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  }> {
    try {
      const memUsage = process.memoryUsage();
      const totalMemory = require('os').totalmem();
      const memoryUsage = (memUsage.heapUsed / totalMemory) * 100;

      const cpuUsage = process.cpuUsage();
      const cpuUsagePercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Simplified

      return {
        memoryUsage,
        cpuUsage: cpuUsagePercent,
        activeConnections: 0 // Would get from actual connection monitoring
      };

    } catch (error) {
      logger.error('Error getting system metrics:', error);
      return {
        memoryUsage: 0,
        cpuUsage: 0,
        activeConnections: 0
      };
    }
  }

  private async getQueueMetrics(): Promise<{
    depth: number;
    latency: number;
  }> {
    try {
      // Get queue size from Redis
      const queueSize = await redisClient.zcard('notifications:queue');

      // Calculate average latency from recent data
      const recentLatencies = this.recentNotifications
        .slice(-100) // Last 100 notifications
        .map(n => n.processingTime);

      const avgLatency = recentLatencies.length > 0
        ? recentLatencies.reduce((sum, time) => sum + time, 0) / recentLatencies.length
        : 0;

      return {
        depth: queueSize,
        latency: avgLatency
      };

    } catch (error) {
      logger.error('Error getting queue metrics:', error);
      return {
        depth: 0,
        latency: 0
      };
    }
  }

  private async performHealthChecks(): Promise<void> {
    const checkPromises = this.healthChecks.map(async (check) => {
      try {
        const startTime = Date.now();
        let status: HealthStatus['checks'][0]['status'] = 'pass';
        let message: string | undefined;

        switch (check.name) {
          case 'redis_connection':
            await redisClient.ping();
            check.responseTime = Date.now() - startTime;
            break;

          case 'memory_usage':
            const memoryUsage = this.currentMetrics.memoryUsage;
            if (memoryUsage > this.config.alertThresholds.memoryUsage) {
              status = 'warning';
              message = `Memory usage at ${memoryUsage.toFixed(1)}%`;
            }
            check.details = { usage_percentage: memoryUsage };
            break;

          case 'cpu_usage':
            const cpuUsage = this.currentMetrics.cpuUsage;
            if (cpuUsage > this.config.alertThresholds.cpuUsage) {
              status = 'warning';
              message = `CPU usage at ${cpuUsage.toFixed(1)}%`;
            }
            check.details = { usage_percentage: cpuUsage };
            break;

          case 'notification_delivery':
            const deliveryRate = this.currentMetrics.successRate;
            if (deliveryRate < this.config.alertThresholds.deliveryRate) {
              status = 'warning';
              message = `Delivery rate at ${deliveryRate.toFixed(1)}%`;
            }
            check.details = { delivery_rate: deliveryRate };
            break;
        }

        check.status = status;
        check.message = message;
        check.lastChecked = new Date();

      } catch (error) {
        check.status = 'fail';
        check.message = error.message;
        check.lastChecked = new Date();
        logger.error(`Health check failed for ${check.name}:`, error);
      }
    });

    await Promise.allSettled(checkPromises);

    const healthStatus = this.calculateOverallHealth();
    await this.saveHealthStatus(healthStatus);

    this.emit('health:updated', healthStatus);
  }

  private calculateOverallHealth(): HealthStatus {
    const failedChecks = this.healthChecks.filter(check => check.status === 'fail').length;
    const warningChecks = this.healthChecks.filter(check => check.status === 'warning').length;
    const totalChecks = this.healthChecks.length;

    let status: HealthStatus['status'];
    let overallScore = 100;

    if (failedChecks > 0) {
      status = 'critical';
      overallScore = Math.max(0, 100 - (failedChecks * 25));
    } else if (warningChecks > totalChecks / 2) {
      status = 'warning';
      overallScore = Math.max(50, 100 - (warningChecks * 10));
    } else if (warningChecks > 0) {
      status = 'warning';
      overallScore = Math.max(75, 100 - (warningChecks * 5));
    } else {
      status = 'healthy';
      overallScore = 100;
    }

    return {
      status,
      checks: this.healthChecks,
      overallScore,
      uptime: 99.9, // Would calculate from actual uptime
      lastRestart: new Date(),
      activeIncidents: failedChecks,
      dependencies: [] // Would be populated with actual dependency checks
    };
  }

  private async analyzePerformance(): Promise<void> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);

      // Analyze recent performance
      const hourNotifications = this.recentNotifications.filter(
        n => n.timestamp > oneHourAgo
      );

      if (hourNotifications.length === 0) {
        return;
      }

      const avgDeliveryTime = hourNotifications.reduce(
        (sum, n) => sum + n.processingTime, 0
      ) / hourNotifications.length;

      const successRate = (hourNotifications.filter(n => n.success).length / hourNotifications.length) * 100;
      const throughput = hourNotifications.length;

      // Create hourly metric entry
      const hourlyMetric = {
        timestamp: now,
        notificationsProcessed: hourNotifications.length,
        averageDeliveryTime: avgDeliveryTime,
        successRate,
        errorRate: 100 - successRate,
        peakThroughput: throughput, // Simplified
        lowThroughput: throughput // Simplified
      };

      this.hourlyMetrics.push(hourlyMetric);

      // Keep only last 24 hours of metrics
      const oneDayAgo = new Date(now.getTime() - 24 * 3600000);
      this.hourlyMetrics = this.hourlyMetrics.filter(
        metric => metric.timestamp > oneDayAgo
      );

      // Analyze trends
      const trends = this.analyzeTrends();

      // Detect bottlenecks
      const bottlenecks = this.detectBottlenecks();

      // Calculate performance score
      const performanceScore = this.calculatePerformanceScore();

      // Save performance data
      const performanceData = {
        currentMetrics: this.currentMetrics,
        hourlyMetrics: this.hourlyMetrics,
        recentNotifications: this.recentNotifications,
        trends,
        bottlenecks,
        performanceScore,
        lastUpdated: now
      };

      await redisClient.setex(
        this.config.performanceKey,
        this.config.performanceHistoryDays * 24 * 3600,
        JSON.stringify(performanceData)
      );

      this.emit('performance:analyzed', {
        metrics: performanceData,
        trends,
        bottlenecks,
        performanceScore
      });

    } catch (error) {
      logger.error('Error analyzing performance:', error);
    }
  }

  private analyzeTrends(): PerformanceMetrics['trends'] {
    if (this.hourlyMetrics.length < 3) {
      return {
        deliveryTimeTrend: 'stable',
        throughputTrend: 'stable',
        errorRateTrend: 'stable',
        performanceScore: 75
      };
    }

    const recent = this.hourlyMetrics.slice(-3);
    const older = this.hourlyMetrics.slice(-6, -3);

    const recentAvgDelivery = recent.reduce((sum, m) => sum + m.averageDeliveryTime, 0) / recent.length;
    const olderAvgDelivery = older.length > 0
      ? older.reduce((sum, m) => sum + m.averageDeliveryTime, 0) / older.length
      : recentAvgDelivery;

    const recentThroughput = recent.reduce((sum, m) => sum + m.notificationsProcessed, 0) / recent.length;
    const olderThroughput = older.length > 0
      ? older.reduce((sum, m) => sum + m.notificationsProcessed, 0) / older.length
      : recentThroughput;

    const recentErrorRate = recent.reduce((sum, m) => sum + m.errorRate, 0) / recent.length;
    const olderErrorRate = older.length > 0
      ? older.reduce((sum, m) => sum + m.errorRate, 0) / older.length
      : recentErrorRate;

    const deliveryTimeTrend = this.calculateTrend(recentAvgDelivery, olderAvgDelivery, true);
    const throughputTrend = this.calculateTrend(recentThroughput, olderThroughput, false);
    const errorRateTrend = this.calculateTrend(recentErrorRate, olderErrorRate, true);

    const performanceScore = this.calculatePerformanceScore();

    return {
      deliveryTimeTrend,
      throughputTrend,
      errorRateTrend,
      performanceScore
    };
  }

  private calculateTrend(
    current: number,
    baseline: number,
    lowerIsBetter: boolean
  ): 'improving' | 'degrading' | 'stable' {
    const change = ((current - baseline) / baseline) * 100;

    if (Math.abs(change) < 5) {
      return 'stable';
    }

    if (lowerIsBetter) {
      return change < 0 ? 'improving' : 'degrading';
    } else {
      return change > 0 ? 'improving' : 'degrading';
    }
  }

  private detectBottlenecks(): PerformanceMetrics['bottlenecks'] {
    const bottlenecks: PerformanceMetrics['bottlenecks'] = [];

    // Check queue bottlenecks
    if (this.currentMetrics.queueDepth > this.config.alertThresholds.queueDepth) {
      bottlenecks.push({
        type: 'queue',
        severity: this.currentMetrics.queueDepth > this.config.alertThresholds.queueDepth * 2 ? 'critical' : 'high',
        description: `Queue depth at ${this.currentMetrics.queueDepth}`,
        impact: 'Notifications are delayed in queue',
        recommendation: 'Increase queue processing capacity or add workers',
        detectedAt: new Date(),
        metrics: { queueDepth: this.currentMetrics.queueDepth }
      });
    }

    // Check processing bottlenecks
    if (this.currentMetrics.averageDeliveryTime > this.config.alertThresholds.processingLatency) {
      bottlenecks.push({
        type: 'processing',
        severity: this.currentMetrics.averageDeliveryTime > this.config.alertThresholds.processingLatency * 2 ? 'critical' : 'high',
        description: `Average delivery time at ${this.currentMetrics.averageDeliveryTime}ms`,
        impact: 'Notifications taking too long to process',
        recommendation: 'Optimize processing pipeline and check resource allocation',
        detectedAt: new Date(),
        metrics: { averageDeliveryTime: this.currentMetrics.averageDeliveryTime }
      });
    }

    // Check error rate bottlenecks
    if (this.currentMetrics.errorRate > this.config.alertThresholds.errorRate) {
      bottlenecks.push({
        type: 'delivery',
        severity: this.currentMetrics.errorRate > this.config.alertThresholds.errorRate * 2 ? 'critical' : 'high',
        description: `Error rate at ${this.currentMetrics.errorRate}%`,
        impact: 'High failure rate affecting user experience',
        recommendation: 'Investigate root cause of delivery failures',
        detectedAt: new Date(),
        metrics: { errorRate: this.currentMetrics.errorRate }
      });
    }

    return bottlenecks;
  }

  private calculatePerformanceScore(): number {
    const baseline = this.config.performanceBaselines;
    const current = this.currentMetrics;

    let score = 100;

    // Delivery time scoring (30% weight)
    const deliveryTimeScore = Math.max(0, 100 - ((current.averageDeliveryTime / baseline.averageDeliveryTime - 1) * 50));
    score = score * 0.7 + deliveryTimeScore * 0.3;

    // Success rate scoring (40% weight)
    const successRateScore = (current.successRate / baseline.successRate) * 100;
    score = score * 0.6 + successRateScore * 0.4;

    // Throughput scoring (20% weight)
    const throughputScore = Math.min(100, (current.notificationsPerMinute / baseline.throughput) * 100);
    score = score * 0.8 + throughputScore * 0.2;

    // Error rate scoring (10% weight)
    const errorRateScore = Math.max(0, 100 - ((current.errorRate / (100 - baseline.successRate)) * 100));
    score = score * 0.9 + errorRateScore * 0.1;

    return Math.min(100, Math.max(0, score));
  }

  private async evaluateAlerts(): Promise<void> {
    try {
      const alerts: MonitoringAlert[] = [];

      // Check delivery rate alert
      if (this.currentMetrics.successRate < this.config.alertThresholds.deliveryRate) {
        const alertId = 'delivery_rate_low';
        const existingAlert = this.activeAlerts.get(alertId);

        if (!existingAlert) {
          alerts.push({
            id: alertId,
            type: 'performance',
            severity: this.currentMetrics.successRate < 90 ? 'critical' : 'high',
            title: 'Low Delivery Rate',
            message: `Delivery rate has dropped to ${this.currentMetrics.successRate.toFixed(1)}%`,
            metrics: { deliveryRate: this.currentMetrics.successRate },
            threshold: this.config.alertThresholds.deliveryRate,
            currentValue: this.currentMetrics.successRate,
            createdAt: new Date(),
            acknowledged: false,
            resolved: false,
            actions: [
              {
                type: 'auto',
                description: 'Check queue health and processing pipeline',
                executed: false
              }
            ]
          });
        }
      }

      // Check error rate alert
      if (this.currentMetrics.errorRate > this.config.alertThresholds.errorRate) {
        const alertId = 'error_rate_high';
        const existingAlert = this.activeAlerts.get(alertId);

        if (!existingAlert) {
          alerts.push({
            id: alertId,
            type: 'error_spike',
            severity: this.currentMetrics.errorRate > 10 ? 'critical' : 'high',
            title: 'High Error Rate',
            message: `Error rate has increased to ${this.currentMetrics.errorRate.toFixed(1)}%`,
            metrics: { errorRate: this.currentMetrics.errorRate },
            threshold: this.config.alertThresholds.errorRate,
            currentValue: this.currentMetrics.errorRate,
            createdAt: new Date(),
            acknowledged: false,
            resolved: false,
            actions: [
              {
                type: 'auto',
                description: 'Check system logs and external API status',
                executed: false
              }
            ]
          });
        }
      }

      // Check queue depth alert
      if (this.currentMetrics.queueDepth > this.config.alertThresholds.queueDepth) {
        const alertId = 'queue_depth_high';
        const existingAlert = this.activeAlerts.get(alertId);

        if (!existingAlert) {
          alerts.push({
            id: alertId,
            type: 'capacity',
            severity: this.currentMetrics.queueDepth > this.config.alertThresholds.queueDepth * 2 ? 'critical' : 'high',
            title: 'High Queue Depth',
            message: `Queue depth has reached ${this.currentMetrics.queueDepth}`,
            metrics: { queueDepth: this.currentMetrics.queueDepth },
            threshold: this.config.alertThresholds.queueDepth,
            currentValue: this.currentMetrics.queueDepth,
            createdAt: new Date(),
            acknowledged: false,
            resolved: false,
            actions: [
              {
                type: 'auto',
                description: 'Increase processing workers or queue capacity',
                executed: false
              }
            ]
          });
        }
      }

      // Save and emit new alerts
      for (const alert of alerts) {
        this.activeAlerts.set(alert.id, alert);
        await this.saveAlert(alert);
        this.emit('alert:triggered', alert);
      }

      // Check for resolved alerts
      await this.checkResolvedAlerts();

    } catch (error) {
      logger.error('Error evaluating alerts:', error);
    }
  }

  private async saveAlert(alert: MonitoringAlert): Promise<void> {
    try {
      await redisClient.hset(
        this.config.alertsKey,
        alert.id,
        JSON.stringify(alert)
      );

      await redisClient.expire(
        this.config.alertsKey,
        this.config.alertsRetentionDays * 24 * 3600
      );

    } catch (error) {
      logger.error('Error saving alert:', error);
    }
  }

  private async checkResolvedAlerts(): Promise<void> {
    const alertsToResolve: string[] = [];

    for (const [alertId, alert] of this.activeAlerts.entries()) {
      let resolved = false;

      switch (alert.id) {
        case 'delivery_rate_low':
          resolved = this.currentMetrics.successRate >= this.config.alertThresholds.deliveryRate;
          break;
        case 'error_rate_high':
          resolved = this.currentMetrics.errorRate <= this.config.alertThresholds.errorRate;
          break;
        case 'queue_depth_high':
          resolved = this.currentMetrics.queueDepth <= this.config.alertThresholds.queueDepth;
          break;
      }

      if (resolved) {
        alert.resolved = true;
        alert.resolvedAt = new Date();
        alertsToResolve.push(alertId);

        await this.saveAlert(alert);
        this.emit('alert:resolved', alert);
      }
    }

    // Remove resolved alerts from active alerts
    for (const alertId of alertsToResolve) {
      this.activeAlerts.delete(alertId);
    }
  }

  // Public API methods
  async getSystemOverview(): Promise<SystemOverview> {
    const healthStatus = this.calculateOverallHealth();
    const trends = this.analyzeTrends();
    const bottlenecks = this.detectBottlenecks();
    const performanceScore = this.calculatePerformanceScore();

    const performanceMetrics: PerformanceMetrics = {
      currentMetrics: this.currentMetrics,
      hourlyMetrics: this.hourlyMetrics,
      trends,
      bottlenecks,
      capacityMetrics: {
        maxThroughput: 1000, // Would calculate from actual data
        currentCapacity: (this.currentMetrics.notificationsPerMinute / 1000) * 100,
        projectedCapacity: 100, // Would calculate from trends
        recommendedScaling: {
          workers: 1,
          queueSize: 1000,
          memory: 512,
          timeframe: 'next_hour'
        }
      }
    };

    const activeAlerts = Array.from(this.activeAlerts.values());

    return {
      status: healthStatus,
      metrics: performanceMetrics,
      alerts: activeAlerts,
      summary: {
        totalNotifications: this.recentNotifications.length,
        successRate: this.currentMetrics.successRate,
        averageDeliveryTime: this.currentMetrics.averageDeliveryTime,
        activeUsers: 0, // Would get from user analytics
        queueDepth: this.currentMetrics.queueDepth,
        systemHealth: healthStatus.overallScore
      }
    };
  }

  async recordNotificationProcessed(
    notification: NotificationData,
    processingTime: number,
    success: boolean
  ): Promise<void> {
    this.recentNotifications.push({
      timestamp: new Date(),
      processingTime,
      success
    });

    // Keep only last 1000 notifications for memory efficiency
    if (this.recentNotifications.length > 1000) {
      this.recentNotifications = this.recentNotifications.slice(-1000);
    }

    this.emit('notification:processed', {
      notification,
      processingTime,
      success,
      currentMetrics: this.currentMetrics
    });
  }

  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    await this.saveAlert(alert);
    this.emit('alert:acknowledged', alert);

    return true;
  }

  async getActiveAlerts(): Promise<MonitoringAlert[]> {
    return Array.from(this.activeAlerts.values());
  }

  async getPerformanceMetrics(
    timeRange?: { start: Date; end: Date }
  ): Promise<PerformanceMetrics> {
    // Filter hourly metrics by time range if specified
    let hourlyMetrics = this.hourlyMetrics;

    if (timeRange) {
      hourlyMetrics = this.hourlyMetrics.filter(
        metric => metric.timestamp >= timeRange.start && metric.timestamp <= timeRange.end
      );
    }

    const trends = this.analyzeTrends();
    const bottlenecks = this.detectBottlenecks();
    const performanceScore = this.calculatePerformanceScore();

    return {
      currentMetrics: this.currentMetrics,
      hourlyMetrics,
      trends,
      bottlenecks,
      capacityMetrics: {
        maxThroughput: 1000,
        currentCapacity: (this.currentMetrics.notificationsPerMinute / 1000) * 100,
        projectedCapacity: 100,
        recommendedScaling: {
          workers: 1,
          queueSize: 1000,
          memory: 512,
          timeframe: 'next_hour'
        }
      }
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    return this.calculateOverallHealth();
  }

  updateConfig(newConfig: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Monitoring config updated', this.config);
  }

  getMonitoringStatus(): {
    isMonitoring: boolean;
    activeAlerts: number;
    metricsCollectionActive: boolean;
    healthChecksActive: boolean;
    performanceAnalysisActive: boolean;
    alertEvaluationActive: boolean;
  } {
    return {
      isMonitoring: this.isMonitoring,
      activeAlerts: this.activeAlerts.size,
      metricsCollectionActive: this.monitoringTimers.has('metrics'),
      healthChecksActive: this.monitoringTimers.has('health'),
      performanceAnalysisActive: this.monitoringTimers.has('performance'),
      alertEvaluationActive: this.monitoringTimers.has('alerts')
    };
  }

  private async saveHealthStatus(healthStatus: HealthStatus): Promise<void> {
    try {
      await redisClient.hset(
        this.config.healthKey,
        'current',
        JSON.stringify(healthStatus)
      );

      await redisClient.expire(
        this.config.healthKey,
        this.config.metricsRetentionDays * 24 * 3600
      );

    } catch (error) {
      logger.error('Error saving health status:', error);
    }
  }

  async shutdown(): Promise<void> {
    this.stopMonitoring();

    // Save final data
    try {
      const finalData = {
        currentMetrics: this.currentMetrics,
        hourlyMetrics: this.hourlyMetrics,
        recentNotifications: this.recentNotifications
      };

      await redisClient.setex(
        this.config.performanceKey,
        this.config.performanceHistoryDays * 24 * 3600,
        JSON.stringify(finalData)
      );

      for (const alert of this.activeAlerts.values()) {
        await this.saveAlert(alert);
      }

      logger.info('Monitoring data saved during shutdown');

    } catch (error) {
      logger.error('Error saving monitoring data during shutdown:', error);
    }

    // Clear memory
    this.activeAlerts.clear();
    this.hourlyMetrics = [];
    this.recentNotifications = [];
    this.healthChecks = [];

    logger.info('Notification monitoring analytics shut down');
  }
}

export default NotificationMonitoringAnalytics;