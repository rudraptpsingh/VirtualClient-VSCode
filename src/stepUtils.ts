/**
 * Utilities for managing scheduled run steps
 */
import { ScheduledRunStep, ScheduledRunsProvider } from './ScheduledRunsProvider';
import { StepStatus } from './constants';
import type { Logger } from './types';

/**
 * Update step status and refresh provider
 */
export function updateStepStatus(
    step: ScheduledRunStep, 
    status: StepStatus, 
    detail?: string,
    provider?: ScheduledRunsProvider
): void {
    step.status = status;
    if (detail !== undefined) {
        step.detail = detail;
    }
    provider?.update();
}

/**
 * Update substep status and optionally update parent
 */
export function updateSubstepStatus(
    parentStep: ScheduledRunStep,
    substepIndex: number,
    status: StepStatus,
    detail?: string,
    provider?: ScheduledRunsProvider
): void {
    if (parentStep.substeps && parentStep.substeps[substepIndex]) {
        updateStepStatus(parentStep.substeps[substepIndex], status, detail);
        provider?.update();
    }
}

/**
 * Mark step as error with consistent error handling
 */
export function markStepAsError(
    step: ScheduledRunStep,
    error: Error | string,
    logger?: Logger,
    provider?: ScheduledRunsProvider
): void {
    const errorMessage = error instanceof Error ? error.message : error;
    updateStepStatus(step, 'error', errorMessage, provider);
    logger?.error(`Step failed: ${errorMessage}`);
}

/**
 * Mark substep as error with consistent error handling
 */
export function markSubstepAsError(
    parentStep: ScheduledRunStep,
    substepIndex: number,
    error: Error | string,
    logger?: Logger,
    provider?: ScheduledRunsProvider
): void {
    const errorMessage = error instanceof Error ? error.message : error;
    updateSubstepStatus(parentStep, substepIndex, 'error', errorMessage, provider);
    
    // Also mark parent as error
    updateStepStatus(parentStep, 'error', errorMessage, provider);
    
    logger?.error(`Substep ${substepIndex} failed: ${errorMessage}`);
}

/**
 * Check if all substeps have completed (success or error)
 */
export function areAllSubstepsComplete(step: ScheduledRunStep): boolean {
    if (!step.substeps || step.substeps.length === 0) {
        return true;
    }
    return step.substeps.every(substep => 
        substep.status === 'success' || substep.status === 'error'
    );
}

/**
 * Check if all substeps succeeded
 */
export function allSubstepsSucceeded(step: ScheduledRunStep): boolean {
    if (!step.substeps || step.substeps.length === 0) {
        return true;
    }
    return step.substeps.every(substep => substep.status === 'success');
}

/**
 * Update parent step status based on substep completion
 */
export function updateParentStepIfComplete(
    parentStep: ScheduledRunStep,
    provider?: ScheduledRunsProvider
): void {
    if (areAllSubstepsComplete(parentStep)) {
        const newStatus: StepStatus = allSubstepsSucceeded(parentStep) ? 'success' : 'error';
        updateStepStatus(parentStep, newStatus, undefined, provider);
    }
}

/**
 * Create standard run steps structure
 */
export function createRunSteps(): ScheduledRunStep[] {
    return [
        new ScheduledRunStep('Setup Machine', 'pending', undefined, [
            new ScheduledRunStep('Create Remote Directory', 'pending'),
            new ScheduledRunStep('Upload Package', 'pending')
        ]),
        new ScheduledRunStep('Run Virtual Client', 'pending', undefined, [
            new ScheduledRunStep('Verify Virtual Client Tool', 'pending'),
            new ScheduledRunStep('Execute Virtual Client Command', 'pending')
        ])
    ];
}
