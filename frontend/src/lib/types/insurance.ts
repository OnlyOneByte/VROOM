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
	notes?: string | null;
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
	policyNumber?: string | null;
	coverageDescription?: string | null;
	deductibleAmount?: number | null;
	coverageLimit?: number | null;
	agentName?: string | null;
	agentPhone?: string | null;
	agentEmail?: string | null;
	totalCost?: number | null;
	monthlyCost?: number | null;
	premiumFrequency?: string | null;
	paymentAmount?: number | null;
	vehicleCoverage?: TermVehicleCoverage;
}

export const CLAIM_TYPES = ['collision', 'theft', 'weather', 'vandalism', 'other'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ['filed', 'in_progress', 'settled', 'denied'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const FAULT_DESIGNATIONS = ['at_fault', 'not_at_fault', 'shared'] as const;
export type FaultDesignation = (typeof FAULT_DESIGNATIONS)[number];

export interface InsuranceClaim {
	id: string;
	policyId: string;
	termId?: string | null;
	vehicleId?: string | null;
	claimDate: string;
	claimType: ClaimType;
	description?: string | null;
	status: ClaimStatus;
	payoutAmount?: number | null;
	faultDesignation?: FaultDesignation | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateClaimRequest {
	claimDate: string;
	claimType: ClaimType;
	description?: string;
	status?: ClaimStatus;
	payoutAmount?: number;
	faultDesignation?: FaultDesignation;
	termId?: string;
	vehicleId?: string;
}

export interface UpdateClaimRequest {
	claimDate?: string;
	claimType?: ClaimType;
	description?: string | null;
	status?: ClaimStatus;
	payoutAmount?: number | null;
	faultDesignation?: FaultDesignation | null;
	termId?: string | null;
	vehicleId?: string | null;
}
