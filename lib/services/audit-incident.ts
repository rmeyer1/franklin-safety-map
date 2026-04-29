import { getEnv } from "@/lib/config/env";
import {
  publishDecisionSchema,
  type AuditAction,
  type AuditReason,
  type ExtractedIncident,
  type ExtractionMetadata,
  type GeocodingResult,
  type PublishDecision,
} from "@/lib/types/domain";

type IncidentAuditInput = {
  incident: ExtractedIncident;
  geocoding: GeocodingResult;
  extractionMetadata: ExtractionMetadata;
};

const HIGH_RISK_CATEGORIES = new Set([
  "bomb threat",
  "explosion",
  "hazmat",
  "officer emergency",
  "person with weapon",
  "shooting",
  "shots fired",
  "stabbing",
  "structure fire",
  "suicidal subject",
  "sexual assault",
  "water rescue",
]);

function normalized(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}

function addReason(reasons: Set<AuditReason>, reason: AuditReason): void {
  reasons.add(reason);
}

function hasHighRiskCategory(incident: ExtractedIncident): boolean {
  const candidates = [
    normalized(incident.category),
    normalized(incident.incidentType),
  ].filter((value): value is string => Boolean(value));

  return candidates.some((candidate) => HIGH_RISK_CATEGORIES.has(candidate));
}

function hasExtractionSignalConflict(incident: ExtractedIncident): boolean {
  const incidentCodes = incident.matchedCodes.filter(
    (match) => match.role === "incident",
  );
  if (incidentCodes.length === 0) {
    return false;
  }

  const extractedCategory = normalized(incident.category ?? incident.incidentType);
  const codeCategories = incidentCodes
    .map((match) => normalized(match.category ?? match.meaning))
    .filter((value): value is string => Boolean(value));

  if (
    extractedCategory &&
    codeCategories.length > 0 &&
    !codeCategories.includes(extractedCategory)
  ) {
    return true;
  }

  return incidentCodes.some(
    (match) =>
      match.severity !== null &&
      Math.abs(match.severity - incident.severity) >= 2,
  );
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function buildActions(input: {
  publishable: boolean;
  audited: boolean;
  needsReview: boolean;
  finalConfidence: number;
  initialConfidence: number;
}): AuditAction[] {
  if (!input.publishable) {
    return ["suppress_publish"];
  }

  const actions = new Set<AuditAction>();

  if (input.audited) {
    actions.add("confirm_publish");
  }

  if (input.finalConfidence < input.initialConfidence) {
    actions.add("downgrade_confidence");
  }

  if (input.needsReview) {
    actions.add("mark_needs_review");
  }

  return [...actions];
}

export interface IncidentAuditService {
  review(input: IncidentAuditInput): PublishDecision;
}

export class DeterministicIncidentAuditService implements IncidentAuditService {
  review(input: IncidentAuditInput): PublishDecision {
    const env = getEnv();
    const reasons = new Set<AuditReason>();
    const weakLocation =
      !input.geocoding.resolved ||
      input.geocoding.confidence < env.AUDIT_MIN_GEOCODE_CONFIDENCE;
    const highRiskCategory = hasHighRiskCategory(input.incident);
    const signalConflict = hasExtractionSignalConflict(input.incident);

    if (input.incident.severity >= env.AUDIT_SEVERITY_THRESHOLD) {
      addReason(reasons, "high_severity");
    }

    if (highRiskCategory) {
      addReason(reasons, "high_risk_category");
    }

    if (input.incident.confidence < env.AUDIT_LOW_CONFIDENCE_THRESHOLD) {
      addReason(reasons, "low_extraction_confidence");
    }

    if (signalConflict) {
      addReason(reasons, "extraction_signal_conflict");
    }

    if (weakLocation) {
      addReason(reasons, "weak_location");
    }

    if (input.incident.needsReview) {
      addReason(reasons, "extractor_requested_review");
    }

    if (input.extractionMetadata.fallbackUsed) {
      addReason(reasons, "extraction_fallback_used");
    }

    const audited = reasons.size > 0;
    const suppress =
      input.incident.confidence < env.AUDIT_SUPPRESS_CONFIDENCE_THRESHOLD &&
      weakLocation &&
      !highRiskCategory &&
      input.incident.severity < env.AUDIT_SEVERITY_THRESHOLD;

    let confidencePenalty = 0;
    if (weakLocation) confidencePenalty += 0.1;
    if (signalConflict) confidencePenalty += 0.15;
    if (input.extractionMetadata.fallbackUsed) confidencePenalty += 0.1;

    const finalConfidence = suppress
      ? clampConfidence(Math.min(input.incident.confidence, env.AUDIT_SUPPRESS_CONFIDENCE_THRESHOLD))
      : clampConfidence(input.incident.confidence - confidencePenalty);
    const needsReview =
      input.incident.needsReview ||
      reasons.has("low_extraction_confidence") ||
      reasons.has("extraction_signal_conflict") ||
      reasons.has("weak_location") ||
      reasons.has("extraction_fallback_used");
    const publishable = !suppress;
    const route = !publishable
      ? "suppressed"
      : audited
        ? "audited_publish"
        : "direct_publish";
    const actions = buildActions({
      publishable,
      audited,
      needsReview,
      finalConfidence,
      initialConfidence: input.incident.confidence,
    });

    return publishDecisionSchema.parse({
      route,
      publishable,
      audited,
      actions,
      reasons: [...reasons],
      initialConfidence: input.incident.confidence,
      finalConfidence,
      needsReview,
      provider: "deterministic",
      metadata: {
        severityThreshold: env.AUDIT_SEVERITY_THRESHOLD,
        lowConfidenceThreshold: env.AUDIT_LOW_CONFIDENCE_THRESHOLD,
        suppressConfidenceThreshold: env.AUDIT_SUPPRESS_CONFIDENCE_THRESHOLD,
        minGeocodeConfidence: env.AUDIT_MIN_GEOCODE_CONFIDENCE,
      },
    });
  }
}

export function createIncidentAuditService(): IncidentAuditService {
  return new DeterministicIncidentAuditService();
}
