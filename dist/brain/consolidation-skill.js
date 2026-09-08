"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consolidationSkill = void 0;
exports.consolidationSkill = {
    description: 'Compress and consolidate brain knowledge, removing repetition and extracting appropriately classified facts from memory when knowledge cleanup is requested.',
    content: `Reduce fragmented specs, constraints, rules, conventions, preferences, decisions, observations and memory into concise topic records. Preserve useful meaning, exceptions, provenance and uncertainty. Creating or installing this skill does not authorize a cleanup run.

## Scope and inventory

Load brain-memory and get_context. Use the requested scope; otherwise use the active project, or default outside a project. Read global context when relevant, but change global knowledge only when explicitly requested. Keep scopes separate. Reviews and tasks use their own workflows and are outside this consolidation.

Use list_knowledge with scope and pagination to inventory all eligible records before writing; search_knowledge and get_context are not complete inventories. Read complete candidate records with get_knowledge and retrieve omitted required context. Note broken files and leave dependent groups untouched. Record the starting file count and content character count for the selected scope. A preview or dry-run request permits analysis only.

## Consolidate by meaning

Group related records by topic, type, authority and retrieval needs. Prefer amending an existing topic record to creating another fragment. Keep groups small enough to inspect completely. Records are retrieved whole: stay comfortably below the reported contextBudget, leaving room for other context. Do not create one giant document or merge unrelated always-recalled rules with occasional reference material merely to reduce file count.

Remove repeated introductions, conversational filler, redundant headings and duplicate facts. Preserve distinct requirements, prohibitions, exceptions, rationale needed to understand decisions, source/date references and useful historical context. Keep exact values and commands where their wording matters. Do not discard information just because it is old or unfamiliar. Resolve a conflict only with evidence of explicit supersession; otherwise retain both positions with their dates and report the ambiguity.

Extract from memory only when appropriate: explicit requirements go to constraints, confirmed intended behavior to specs, confirmed choices to decisions, established practices to conventions, and user choices to preferences. Code-derived facts remain inferred observations; historical plans and unattributed suggestions remain memory or observations. Existing inferred authority cannot become user authority merely through compression. Leave uncertain classifications unchanged and report them. Keep current behavior distinct from desired behavior. Amend a matching destination and preserve its unrelated content; retain useful residual memory after a partial extraction.

## Reconcile specifications

When supplied comments or memory records contain a clear, authoritative change to an existing requirement, read the affected spec and amend its relevant section. Verify authorship, scope and evidence of supersession; a newer timestamp, code comment or assistant suggestion alone does not establish a requirement change. Preserve unrelated requirements and a concise source/date reference. Update the canonical spec instead of leaving the correction only in memory. A requirement change does not prove the implementation already complies.

Before editing or compressing a spec, check for sections explicitly marked immutable or locked. Preserve those sections verbatim unless the user has explicitly authorized changing the affected section. Do not bypass a lock by removing the section, archiving the spec or writing a replacement that changes it. If a proposed correction conflicts with a lock, leave the section and supporting source intact, report the conflict, and continue independent work on mutable sections. Do not infer immutability from a section's importance or age.

## Write, verify, archive

Use remember and amend_knowledge with current revisions. Preserve scope and authority, meaningful tags, always recall, and applies_to patterns. Type changes require an appropriately typed destination. For each source, account for every meaningful point in the destination records or retained residual memory before removing it. Keep a source-to-destination mapping during the work.

Read back each destination and compare it with the complete originals. Fix omissions first. Update affected brain indexes and references through the knowledge tools to point to surviving records. Do not edit knowledge files directly. Leave sources in place when coverage or a required reference update cannot be verified.

Once coverage is verified, use archive_knowledge with source IDs/revisions, each source's replacement IDs/revisions, and a concise reason. The tool requires the same scope and authority, preserves exact originals and replacement references in one knowledge-history.jsonl per scope, then removes the old files. Keep destinations out of the archive source set. For an in-place compression, simply amend the existing record; it remains the canonical ID. Do not substitute deprecation for physical consolidation or delete files by hand.

On a revision conflict, reread and reconcile before continuing. An interrupted archive can be retried with the same request while revisions still match; knowledge_history with an old ID retrieves the original text and replacement mapping. If a replacement was later consolidated, follow its ID through history. Archive history is excluded from ordinary retrieval. If these tools are unavailable, report that agent-brain needs updating before archiving; preserve the sources.

Re-list after changes, verify destinations are readable and archived sources are absent, and test retrieval for representative topics. Report before/after knowledge file counts and content characters, extracted categories, unresolved contradictions and any incomplete work. Count the shared archive file separately; do not describe reduced active text as reduced total disk bytes. Future corrections should amend these topic records. This workflow does not authorize Git or remote writes.`
};
