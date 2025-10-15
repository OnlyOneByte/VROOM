// Performance monitoring utilities

// Type definitions for performance APIs
interface LayoutShift extends PerformanceEntry {
	value: number;
	hadRecentInput: boolean;
}

export interface PerformanceMetrics {
	name: string;
	duration: number;
	startTime: number;
	endTime: number;
	metadata?: Record<string, unknown> | undefined;
}

class PerformanceMonitor {
	private measurements = new Map<string, number>();
	private metrics: PerformanceMetrics[] = [];

	// Start timing an operation
	start(name: string): void {
		this.measurements.set(name, performance.now());
	}

	// End timing and record the metric
	end(name: string, metadata?: Record<string, unknown>): PerformanceMetrics | null {
		const startTime = this.measurements.get(name);
		if (!startTime) {
			console.warn(`Performance measurement '${name}' was not started`);
			return null;
		}

		const endTime = performance.now();
		const duration = endTime - startTime;

		const metric: PerformanceMetrics = {
			name,
			duration,
			startTime,
			endTime,
			metadata: metadata ?? undefined
		};

		this.metrics.push(metric);
		this.measurements.delete(name);

		// Log slow operations
		if (duration > 1000) {
			console.warn(`Slow operation detected: ${name} took ${duration.toFixed(2)}ms`);
		}

		return metric;
	}

	// Get all recorded metrics
	getMetrics(): PerformanceMetrics[] {
		return [...this.metrics];
	}

	// Get metrics by name
	getMetricsByName(name: string): PerformanceMetrics[] {
		return this.metrics.filter(metric => metric.name === name);
	}

	// Clear all metrics
	clear(): void {
		this.metrics = [];
		this.measurements.clear();
	}

	// Get average duration for a metric name
	getAverageDuration(name: string): number {
		const metrics = this.getMetricsByName(name);
		if (metrics.length === 0) return 0;

		const total = metrics.reduce((sum, metric) => sum + metric.duration, 0);
		return total / metrics.length;
	}
}

export const performanceMonitor = new PerformanceMonitor();

// Decorator for timing functions
export function timed(name?: string) {
	return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		const metricName =
			name || `${(target as { constructor: { name: string } }).constructor.name}.${propertyKey}`;

		descriptor.value = async function (...args: unknown[]) {
			performanceMonitor.start(metricName);
			try {
				const result = await originalMethod.apply(this, args);
				performanceMonitor.end(metricName);
				return result;
			} catch (error) {
				performanceMonitor.end(metricName, { error: true });
				throw error;
			}
		};

		return descriptor;
	};
}

// Utility to measure async operations
export async function measureAsync<T>(
	name: string,
	operation: () => Promise<T>,
	metadata?: Record<string, unknown>
): Promise<T> {
	performanceMonitor.start(name);
	try {
		const result = await operation();
		performanceMonitor.end(name, metadata);
		return result;
	} catch (error) {
		performanceMonitor.end(name, { ...metadata, error: true });
		throw error;
	}
}

// Utility to measure sync operations
export function measure<T>(
	name: string,
	operation: () => T,
	metadata?: Record<string, unknown>
): T {
	performanceMonitor.start(name);
	try {
		const result = operation();
		performanceMonitor.end(name, metadata);
		return result;
	} catch (error) {
		performanceMonitor.end(name, { ...metadata, error: true });
		throw error;
	}
}

// Web Vitals monitoring
export interface WebVitals {
	fcp?: number; // First Contentful Paint
	lcp?: number; // Largest Contentful Paint
	fid?: number; // First Input Delay
	cls?: number; // Cumulative Layout Shift
	ttfb?: number; // Time to First Byte
}

class WebVitalsMonitor {
	private vitals: WebVitals = {};

	constructor() {
		this.observePerformance();
	}

	private observePerformance(): void {
		// Observe paint metrics
		if ('PerformanceObserver' in window) {
			// First Contentful Paint
			new PerformanceObserver(list => {
				for (const entry of list.getEntries()) {
					if (entry.name === 'first-contentful-paint') {
						this.vitals.fcp = entry.startTime;
					}
				}
			}).observe({ entryTypes: ['paint'] });

			// Largest Contentful Paint
			new PerformanceObserver(list => {
				const entries = list.getEntries();
				const lastEntry = entries[entries.length - 1];
				if (lastEntry) {
					this.vitals.lcp = lastEntry.startTime;
				}
			}).observe({ entryTypes: ['largest-contentful-paint'] });

			// First Input Delay
			new PerformanceObserver(list => {
				for (const entry of list.getEntries()) {
					const fidEntry = entry as PerformanceEventTiming;
					this.vitals.fid = fidEntry.processingStart - entry.startTime;
				}
			}).observe({ entryTypes: ['first-input'] });

			// Cumulative Layout Shift
			new PerformanceObserver(list => {
				let cls = 0;
				for (const entry of list.getEntries()) {
					const clsEntry = entry as LayoutShift;
					if (!clsEntry.hadRecentInput) {
						cls += clsEntry.value;
					}
				}
				this.vitals.cls = cls;
			}).observe({ entryTypes: ['layout-shift'] });
		}

		// Time to First Byte
		window.addEventListener('load', () => {
			const navigation = performance.getEntriesByType(
				'navigation'
			)[0] as PerformanceNavigationTiming;
			this.vitals.ttfb = navigation.responseStart - navigation.requestStart;
		});
	}

	getVitals(): WebVitals {
		return { ...this.vitals };
	}

	// Check if vitals meet good thresholds
	getVitalsScore(): {
		score: number;
		details: Record<string, 'good' | 'needs-improvement' | 'poor'>;
	} {
		const details: Record<string, 'good' | 'needs-improvement' | 'poor'> = {};
		let score = 0;
		let totalMetrics = 0;

		if (this.vitals['fcp'] !== undefined) {
			totalMetrics++;
			if (this.vitals['fcp'] <= 1800) {
				details['fcp'] = 'good';
				score++;
			} else if (this.vitals['fcp'] <= 3000) {
				details['fcp'] = 'needs-improvement';
			} else {
				details['fcp'] = 'poor';
			}
		}

		if (this.vitals['lcp'] !== undefined) {
			totalMetrics++;
			if (this.vitals['lcp'] <= 2500) {
				details['lcp'] = 'good';
				score++;
			} else if (this.vitals['lcp'] <= 4000) {
				details['lcp'] = 'needs-improvement';
			} else {
				details['lcp'] = 'poor';
			}
		}

		if (this.vitals['fid'] !== undefined) {
			totalMetrics++;
			if (this.vitals['fid'] <= 100) {
				details['fid'] = 'good';
				score++;
			} else if (this.vitals['fid'] <= 300) {
				details['fid'] = 'needs-improvement';
			} else {
				details['fid'] = 'poor';
			}
		}

		if (this.vitals['cls'] !== undefined) {
			totalMetrics++;
			if (this.vitals['cls'] <= 0.1) {
				details['cls'] = 'good';
				score++;
			} else if (this.vitals['cls'] <= 0.25) {
				details['cls'] = 'needs-improvement';
			} else {
				details['cls'] = 'poor';
			}
		}

		return {
			score: totalMetrics > 0 ? (score / totalMetrics) * 100 : 0,
			details
		};
	}
}

export const webVitalsMonitor = new WebVitalsMonitor();

// Bundle size monitoring
export function logBundleSize(): void {
	if ('performance' in window && 'getEntriesByType' in performance) {
		const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
		const jsResources = resources.filter(resource => resource.name.endsWith('.js'));
		const cssResources = resources.filter(resource => resource.name.endsWith('.css'));

		const totalJSSize = jsResources.reduce(
			(total, resource) => total + (resource.transferSize || 0),
			0
		);
		const totalCSSSize = cssResources.reduce(
			(total, resource) => total + (resource.transferSize || 0),
			0
		);

		if (import.meta.env.DEV) {
			console.log('Bundle Analysis:', {
				jsFiles: jsResources.length,
				cssFiles: cssResources.length,
				totalJSSize: `${(totalJSSize / 1024).toFixed(2)} KB`,
				totalCSSSize: `${(totalCSSSize / 1024).toFixed(2)} KB`,
				totalSize: `${((totalJSSize + totalCSSSize) / 1024).toFixed(2)} KB`
			});
		}
	}
}

// Memory usage monitoring
export function getMemoryUsage(): { used: number; total: number; percentage: number } | null {
	if ('memory' in performance) {
		const memory = (performance as { memory: { usedJSHeapSize: number; totalJSHeapSize: number } })
			.memory;
		return {
			used: memory.usedJSHeapSize,
			total: memory.totalJSHeapSize,
			percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100
		};
	}
	return null;
}
