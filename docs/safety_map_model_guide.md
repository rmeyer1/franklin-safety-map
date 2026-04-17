# LLM Model Selection Guide: AI-Listener Component

This document outlines the LLM strategy for the "AI-Listener" pipeline, which converts raw radio transcriptions into structured map markers.

## 1. Objective
The goal is to achieve high accuracy in Named Entity Recognition (NER) for public safety dispatches (Incident Type, Location, Priority) while minimizing inference cost and latency.

## 2. Recommended Model Tiering

To balance cost and precision, we implement a **Two-Tier Extraction Strategy**.

### Tier 1: The Workhorse (Primary Extraction)
**Model:** `Llama 3.1 8B` (via Ollama Cloud)
*   **Role:** Primary parser for all audio transcriptions.
*   **Why:** Best-in-class balance of speed and JSON reliability for small-to-medium parameter counts.
*   **Expected Performance:** High accuracy for standard dispatch patterns; low latency.

### Tier 2: The Auditor (Verification & Ambiguity)
**Model:** `Mistral Nemo (12B)` or `Llama 3.1 70B` (via Ollama Cloud)
*   **Role:** Verification of "Critical" or "Ambiguous" incidents.
*   **Trigger:** If the Tier 1 model flags a `priority: "Critical"` or if the `confidence_score` is low.
*   **Why:** Higher parameter counts provide better nuance for complex addresses or non-standard radio terminology.

---

## 3. Implementation Requirements

### 3.1 Constrained Output (JSON Mode)
The developer MUST use the `format: "json"` parameter in the Ollama API call to ensure the output is always a valid JSON object, preventing pipeline crashes.

### 3.2 Prompt Engineering Strategy
To maximize extraction accuracy, the following prompting techniques are required:

#### A. Few-Shot Prompting
The system prompt must include 3-5 diverse examples of `Transcribed Text` $\rightarrow$ `JSON Output` to teach the model the specific terminology of Franklin County dispatch (e.g., "10-codes").

#### B. Strict Schema Enforcement
The model must be instructed to follow this exact schema:
```json
{
  "incident_type": "string | null",
  "location": {
    "raw_text": "string | null",
    "normalized_address": "string | null"
  },
  "priority": "Low" | "Medium" | "High" | "Critical",
  "confidence_score": 0.0-1.0,
  "is_ambiguous": boolean
}
```

#### C. Negative Constraints
The prompt must explicitly forbid:
*   Conversational filler (e.g., "Here is the extraction...").
*   Guessing locations (if not mentioned, return `null`).
*   Adding information not present in the transcription.

---

## 4. Cost & Performance Matrix

| Tier | Model | Cost | Latency | Accuracy | Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T1** | Llama 3.1 8B | Very Low | Ultra-Low | High | 95% of all calls |
| **T2** | Mistral Nemo/Llama 70B | Medium | Low | Elite | Critical/Ambiguous calls |
