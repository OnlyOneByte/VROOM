import * as d3 from 'd3';

export interface ChartData {
	period: string;
	amount?: number;
	miles?: number;
	costPerMile?: number;
	mpg?: number;
	mileage?: number;
}

export interface CategoryData {
	category: string;
	amount: number;
	count: number;
	percentage: number;
}

export interface ChartConfig {
	width: number;
	height: number;
	margin: { top: number; right: number; bottom: number; left: number };
	colors?: string[];
}

export const defaultChartConfig: ChartConfig = {
	width: 800,
	height: 400,
	margin: { top: 20, right: 30, bottom: 40, left: 50 },
	colors: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4']
};

export function createLineChart(
	container: HTMLElement,
	data: ChartData[],
	config: Partial<ChartConfig> = {}
) {
	const chartConfig = { ...defaultChartConfig, ...config };
	const { width, height, margin } = chartConfig;

	// Clear previous chart
	d3.select(container).selectAll('*').remove();

	const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	// Parse dates and sort data
	const parseDate = d3.timeParse('%Y-%m');
	const sortedData = data
		.map(d => ({
			...d,
			date: parseDate(d.period) || new Date(d.period)
		}))
		.sort((a, b) => a.date.getTime() - b.date.getTime());

	// Scales
	const xScale = d3
		.scaleTime()
		.domain(d3.extent(sortedData, d => d.date) as [Date, Date])
		.range([0, innerWidth]);

	const yScale = d3
		.scaleLinear()
		.domain([0, d3.max(sortedData, d => d.amount || 0) as number])
		.nice()
		.range([innerHeight, 0]);

	// Line generator
	const line = d3
		.line<{ date: Date; amount?: number }>()
		.x(d => xScale(d.date))
		.y(d => yScale(d.amount || 0))
		.curve(d3.curveMonotoneX);

	// Add axes
	g.append('g')
		.attr('transform', `translate(0,${innerHeight})`)
		.call(d3.axisBottom(xScale).tickFormat(d => d3.timeFormat('%b %Y')(d as Date)));

	g.append('g').call(d3.axisLeft(yScale).tickFormat(d => `$${d}`));

	// Add line
	g.append('path')
		.datum(sortedData)
		.attr('fill', 'none')
		.attr('stroke', chartConfig.colors?.[0] || '#3b82f6')
		.attr('stroke-width', 2)
		.attr('d', line);

	// Add dots
	g.selectAll('.dot')
		.data(sortedData)
		.enter()
		.append('circle')
		.attr('class', 'dot')
		.attr('cx', d => xScale(d.date))
		.attr('cy', d => yScale(d.amount || 0))
		.attr('r', 4)
		.attr('fill', chartConfig.colors?.[0] || '#3b82f6');

	// Add tooltip
	const tooltip = d3
		.select('body')
		.append('div')
		.attr('class', 'tooltip')
		.style('opacity', 0)
		.style('position', 'absolute')
		.style('background', 'rgba(0, 0, 0, 0.8)')
		.style('color', 'white')
		.style('padding', '8px')
		.style('border-radius', '4px')
		.style('font-size', '12px')
		.style('pointer-events', 'none');

	g.selectAll('.dot')
		.on('mouseover', function (event, d) {
			const _data = d as { date: Date; amount?: number };
			tooltip.transition().duration(200).style('opacity', 0.9);
			tooltip
				.html(
					`
        <div>Date: ${d3.timeFormat('%b %Y')(_data.date)}</div>
        <div>Amount: $${(_data.amount || 0).toFixed(2)}</div>
      `
				)
				.style('left', event.pageX + 10 + 'px')
				.style('top', event.pageY - 28 + 'px');
		})
		.on('mouseout', function () {
			tooltip.transition().duration(500).style('opacity', 0);
		});

	return svg.node();
}

export function createBarChart(
	container: HTMLElement,
	data: CategoryData[],
	config: Partial<ChartConfig> = {}
) {
	const chartConfig = { ...defaultChartConfig, ...config };
	const { width, height, margin } = chartConfig;

	// Clear previous chart
	d3.select(container).selectAll('*').remove();

	const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	// Scales
	const xScale = d3
		.scaleBand()
		.domain(data.map(d => d.category))
		.range([0, innerWidth])
		.padding(0.1);

	const yScale = d3
		.scaleLinear()
		.domain([0, d3.max(data, d => d.amount) as number])
		.nice()
		.range([innerHeight, 0]);

	// Color scale
	const colorScale = d3
		.scaleOrdinal()
		.domain(data.map(d => d.category))
		.range(chartConfig.colors || d3.schemeCategory10);

	// Add axes
	g.append('g')
		.attr('transform', `translate(0,${innerHeight})`)
		.call(d3.axisBottom(xScale))
		.selectAll('text')
		.style('text-anchor', 'end')
		.attr('dx', '-.8em')
		.attr('dy', '.15em')
		.attr('transform', 'rotate(-45)');

	g.append('g').call(d3.axisLeft(yScale).tickFormat(d => `$${d}`));

	// Add bars
	g.selectAll('.bar')
		.data(data)
		.enter()
		.append('rect')
		.attr('class', 'bar')
		.attr('x', d => xScale(d.category) || 0)
		.attr('width', xScale.bandwidth())
		.attr('y', d => yScale(d.amount))
		.attr('height', d => innerHeight - yScale(d.amount))
		.attr('fill', d => colorScale(d.category) as string);

	// Add tooltip
	const tooltip = d3
		.select('body')
		.append('div')
		.attr('class', 'tooltip')
		.style('opacity', 0)
		.style('position', 'absolute')
		.style('background', 'rgba(0, 0, 0, 0.8)')
		.style('color', 'white')
		.style('padding', '8px')
		.style('border-radius', '4px')
		.style('font-size', '12px')
		.style('pointer-events', 'none');

	g.selectAll('.bar')
		.on('mouseover', function (event, d) {
			const _data = d as CategoryData;
			tooltip.transition().duration(200).style('opacity', 0.9);
			tooltip
				.html(
					`
        <div>Category: ${_data.category}</div>
        <div>Amount: $${_data.amount.toFixed(2)}</div>
        <div>Count: ${_data.count} expenses</div>
        <div>Percentage: ${_data.percentage.toFixed(1)}%</div>
      `
				)
				.style('left', event.pageX + 10 + 'px')
				.style('top', event.pageY - 28 + 'px');
		})
		.on('mouseout', function () {
			tooltip.transition().duration(500).style('opacity', 0);
		});

	return svg.node();
}

export function createPieChart(
	container: HTMLElement,
	data: CategoryData[],
	config: Partial<ChartConfig> = {}
) {
	const chartConfig = { ...defaultChartConfig, ...config };
	const { width, height } = chartConfig;

	// Clear previous chart
	d3.select(container).selectAll('*').remove();

	const radius = Math.min(width, height) / 2 - 40;

	const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

	const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);

	// Color scale
	const colorScale = d3
		.scaleOrdinal()
		.domain(data.map(d => d.category))
		.range(chartConfig.colors || d3.schemeCategory10);

	// Pie generator
	const pie = d3
		.pie<CategoryData>()
		.value(d => d.amount)
		.sort(null);

	// Arc generator
	const arc = d3.arc<d3.PieArcDatum<CategoryData>>().innerRadius(0).outerRadius(radius);

	const labelArc = d3
		.arc<d3.PieArcDatum<CategoryData>>()
		.innerRadius(radius * 0.6)
		.outerRadius(radius * 0.6);

	// Add slices
	const slices = g.selectAll('.slice').data(pie(data)).enter().append('g').attr('class', 'slice');

	slices
		.append('path')
		.attr('d', arc)
		.attr('fill', d => colorScale(d.data.category) as string)
		.attr('stroke', 'white')
		.attr('stroke-width', 2);

	// Add labels
	slices
		.append('text')
		.attr('transform', d => `translate(${labelArc.centroid(d)})`)
		.attr('text-anchor', 'middle')
		.attr('font-size', '12px')
		.attr('fill', 'white')
		.text(d => (d.data.percentage > 5 ? `${d.data.percentage.toFixed(1)}%` : ''));

	// Add tooltip
	const tooltip = d3
		.select('body')
		.append('div')
		.attr('class', 'tooltip')
		.style('opacity', 0)
		.style('position', 'absolute')
		.style('background', 'rgba(0, 0, 0, 0.8)')
		.style('color', 'white')
		.style('padding', '8px')
		.style('border-radius', '4px')
		.style('font-size', '12px')
		.style('pointer-events', 'none');

	slices
		.selectAll('path')
		.on('mouseover', function (event, d) {
			const _data = d as d3.PieArcDatum<CategoryData>;
			tooltip.transition().duration(200).style('opacity', 0.9);
			tooltip
				.html(
					`
        <div>Category: ${_data.data.category}</div>
        <div>Amount: $${_data.data.amount.toFixed(2)}</div>
        <div>Count: ${_data.data.count} expenses</div>
        <div>Percentage: ${_data.data.percentage.toFixed(1)}%</div>
      `
				)
				.style('left', event.pageX + 10 + 'px')
				.style('top', event.pageY - 28 + 'px');
		})
		.on('mouseout', function () {
			tooltip.transition().duration(500).style('opacity', 0);
		});

	return svg.node();
}

export function createMultiLineChart(
	container: HTMLElement,
	data: { [key: string]: ChartData[] },
	config: Partial<ChartConfig> = {}
) {
	const chartConfig = { ...defaultChartConfig, ...config };
	const { width, height, margin } = chartConfig;

	// Clear previous chart
	d3.select(container).selectAll('*').remove();

	const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

	const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	// Parse dates and prepare data
	const parseDate = d3.timeParse('%Y-%m');
	const allData: Array<{
		key: string;
		values: Array<{ date: Date; value: number; period: string }>;
	}> = [];

	Object.entries(data).forEach(([key, values]) => {
		const processedValues = values
			.map(d => ({
				date: parseDate(d.period) || new Date(d.period),
				value: d.amount || d.miles || d.costPerMile || d.mpg || 0,
				period: d.period
			}))
			.sort((a, b) => a.date.getTime() - b.date.getTime());

		allData.push({ key, values: processedValues });
	});

	// Scales
	const allValues = allData.flatMap(d => d.values);
	const xScale = d3
		.scaleTime()
		.domain(d3.extent(allValues, d => d.date) as [Date, Date])
		.range([0, innerWidth]);

	const yScale = d3
		.scaleLinear()
		.domain([0, d3.max(allValues, d => d.value) as number])
		.nice()
		.range([innerHeight, 0]);

	// Color scale
	const colorScale = d3
		.scaleOrdinal()
		.domain(Object.keys(data))
		.range(chartConfig.colors || d3.schemeCategory10);

	// Line generator
	const line = d3
		.line<{ date: Date; value: number }>()
		.x(d => xScale(d.date))
		.y(d => yScale(d.value))
		.curve(d3.curveMonotoneX);

	// Add axes
	g.append('g')
		.attr('transform', `translate(0,${innerHeight})`)
		.call(d3.axisBottom(xScale).tickFormat(d => d3.timeFormat('%b %Y')(d as Date)));

	g.append('g').call(d3.axisLeft(yScale));

	// Add lines
	allData.forEach(series => {
		g.append('path')
			.datum(series.values)
			.attr('fill', 'none')
			.attr('stroke', colorScale(series.key) as string)
			.attr('stroke-width', 2)
			.attr('d', line);

		// Add dots
		g.selectAll(`.dot-${series.key}`)
			.data(series.values)
			.enter()
			.append('circle')
			.attr('class', `dot dot-${series.key}`)
			.attr('cx', d => xScale(d.date))
			.attr('cy', d => yScale(d.value))
			.attr('r', 3)
			.attr('fill', colorScale(series.key) as string);
	});

	// Add legend
	const legend = svg.append('g').attr('transform', `translate(${width - 120}, 20)`);

	Object.keys(data).forEach((key, i) => {
		const legendRow = legend.append('g').attr('transform', `translate(0, ${i * 20})`);

		legendRow
			.append('rect')
			.attr('width', 12)
			.attr('height', 12)
			.attr('fill', colorScale(key) as string);

		legendRow.append('text').attr('x', 16).attr('y', 9).attr('font-size', '12px').text(key);
	});

	return svg.node();
}

// Cleanup function to remove tooltips
export function cleanupTooltips() {
	d3.selectAll('.tooltip').remove();
}
