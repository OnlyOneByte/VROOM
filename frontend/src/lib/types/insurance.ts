// v2: Flat insurance term type matching insurance_terms table columns
export interface InsuranceTerm {
	id: string;
	policyId: string;
	startDate: string;
	endDate: string;
	policyNumber?: string;
	coverageDescription?: string;
	deductibleAmount?: number;
	coverageLimit?: number;
	agentName?: string;
	agentPhone?: string;
	agentEmail?: string;
	totalCost?: number;
	monthlyCost?: number;
	premiumFrequency?: string;
	paymentAmount?: number;
	createdAt: string;
	updatedAt: string;
}

export interface TermVehicleCoverage {
	vehicleIds: string[];
	splitMethod?: 'even' | 'absolute' | 'percentage';
	allocations?: Array<{ vehicleId: string; amount?: number; percentage?: number }>;
}

export interface TermCoverageRow {
	termId: string;
	vehicleId: string;
}

export interface InsurancePolicy {
	id: string;
	company: string;
	isActive: boolean;
	notes?: string;
	vehicleIds: string[];
	terms: InsuranceTerm[];
	termVehicleCoverage: TermCoverageRow[];
	createdAt: string;
	updatedAt: string;
}

export interface CreatePolicyRequest {
	company: string;
	terms: CreateTermRequest[];
	notes?: string;
	isActive?: boolean;
}

export interface UpdatePolicyRequest {
	company?: string;
	notes?: string;
	isActive?: boolean;
}

export interface CreateTermRequest {
	startDate: string;
	endDate: string;
	policyNumber?: string;
	coverageDescription?: string;
	deductibleAmount?: number;
	coverageLimit?: number;
	agentName?: string;
	agentPhone?: string;
	agentEmail?: string;
	totalCost?: number;
	monthlyCost?: number;
	premiumFrequency?: string;
	paymentAmount?: number;
	vehicleCoverage: TermVehicleCoverage;
}

export interface UpdateTermRequest {
	startDate?: string;
	endDate?: string;
	policyNumber?: string;
	coverageDescription?: string;
	deductibleAmount?: number;
	coverageLimit?: number;
	agentName?: string;
	agentPhone?: string;
	agentEmail?: string;
	totalCost?: number;
	monthlyCost?: number;
	premiumFrequency?: string;
	paymentAmount?: number;
	vehicleCoverage?: TermVehicleCoverage;
}
