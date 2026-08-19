import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSpecialties,
  fetchPatient,
  generateDraft,
  regenerateSection,
  approveSummary,
  fetchSummary,
} from './api.js';
import PatientSelect from './components/PatientSelect.jsx';
import PatientBanner from './components/PatientBanner.jsx';
import SectionNav from './components/SectionNav.jsx';
import DraftPanel from './components/DraftPanel.jsx';
import EditPanel from './components/EditPanel.jsx';
import ApproveBar from './components/ApproveBar.jsx';

const DEFAULT_DFN = 'PAT123456';

// The specialties API contract only guarantees { key, label, sectionCount }.
// If a future response includes per-specialty section metadata we use it;
// otherwise we fall back to the one known requiredManual rule (CTVS Procedure)
// and additionally surface the server's 400 error on approve.
const FALLBACK_REQUIRED_MANUAL = { ctvs: ['procedure'] };

const SECTION_TITLES = {
  'discharge-datetime': 'Date and Time of Discharge',
  diagnosis: 'Diagnosis',
  'presenting-complaints': 'Presenting Complaints',
  hpi: 'History of Present Illness',
  'past-medical-history': 'Past Medical History',
  'current-medication': 'Current Medication',
  'personal-history': 'Personal History',
  'family-history': 'Family History',
  allergies: 'Allergies',
  'occupational-history': 'Occupational History',
  'on-examination': 'On Examination',
  'course-in-hospital': 'Course in Hospital',
  'condition-at-discharge': 'Condition at Discharge',
  procedure: 'Procedure',
  'medications-during-stay': 'Medications During Stay',
  'medications-on-discharge': 'Medications on Discharge',
  advice: 'Advice',
  'special-needs': 'Special Needs',
  'follow-up-advice': 'Follow Up Advice',
};

function titleFor(id) {
  if (SECTION_TITLES[id]) return SECTION_TITLES[id];
  return id
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function objToEntries(obj) {
  return Object.entries(obj || {});
}

export default function App() {
  const [dfnInput, setDfnInput] = useState(DEFAULT_DFN);
  const [specialty, setSpecialty] = useState('general');
  const [specialties, setSpecialties] = useState([]);

  const [patient, setPatient] = useState(null);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState('');

  const [sectionOrder, setSectionOrder] = useState([]);
  const [sectionMeta, setSectionMeta] = useState({}); // id -> { source, manualEntry } when provided
  const [drafts, setDrafts] = useState({}); // id -> AI text
  const [edits, setEdits] = useState({}); // id -> doctor text ("" = untouched)
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [regenState, setRegenState] = useState({}); // id -> { loading, error }

  const [activeSection, setActiveSection] = useState('');

  const [approved, setApproved] = useState(null); // { sections, approvedAt, approvedBy, specialty }
  const [approvedBy, setApprovedBy] = useState('');
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  const [approveMissing, setApproveMissing] = useState([]);
  const [justApproved, setJustApproved] = useState(false);

  const readOnly = Boolean(approved);

  // What was last successfully loaded, so "Load Patient" only re-fires when the
  // DFN or specialty has actually changed since the last load.
  const abortRef = useRef(null); // AbortController for the in-flight load

  const loading = patientLoading || draftLoading;

  useEffect(() => {
    let cancelled = false;
    fetchSpecialties()
      .then((res) => {
        if (!cancelled && res && Array.isArray(res.specialties)) {
          setSpecialties(res.specialties);
          if (res.specialties.length && !res.specialties.some((s) => s.key === 'general')) {
            setSpecialty(res.specialties[0].key);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSpecialties([{ key: 'general', label: 'General', sectionCount: 0 }]);
          console.error('[App] fetching specialties failed:', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPatient = useCallback(async (dfn, spec) => {
    // Drop any previous in-flight load superseded by this one.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    setPatientLoading(true);
    setPatientError('');
    setDraftError('');
    setDraftLoading(false);
    setDrafts({});
    setEdits({});
    setSectionOrder([]);
    setSectionMeta({});
    setRegenState({});
    setActiveSection('');
    setApproved(null);
    setApproveError('');
    setApproveMissing([]);
    setJustApproved(false);

    try {
      const p = await fetchPatient(dfn, signal);
      if (signal.aborted) return;
      setPatient(p);
      setPatientLoading(false);

      const sumRes = await fetchSummary(dfn, signal).catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return null;
      });
      if (signal.aborted) return;
      const existing =
        sumRes && sumRes.summary && sumRes.summary.sections ? sumRes.summary : null;
      if (existing) {
        const ids = Object.keys(existing.sections);
        setApproved(existing);
        if (existing.specialty) setSpecialty(existing.specialty);
        setSectionOrder(ids);
        setDrafts({});
        setEdits(existing.sections);
        setActiveSection(ids[0] || '');
        return;
      }

      // No existing approved summary — auto-generate the first draft.
      setDraftLoading(true);
      try {
        const d = await generateDraft(dfn, spec, signal);
        if (signal.aborted) return;
        const ids = Object.keys(d.sections || {});
        setSectionOrder(ids);
        setDrafts(d.sections || {});
        setEdits({});
        setActiveSection(ids[0] || '');
        setDraftLoading(false);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setDraftLoading(false);
        setDraftError(err.message || 'Draft generation failed');
        console.error('[App] draft generation failed:', err);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setPatientLoading(false);
      setPatient(null);
      setPatientError(err.message || 'Patient data unavailable');
      console.error('[App] patient fetch failed:', err);
    }
  }, []);

  // requiredManual section ids, from server metadata if present, else fallback map.
  const requiredManualIds = useMemo(() => {
    const spec = specialties.find((s) => s.key === specialty);
    if (spec && Array.isArray(spec.sections)) {
      return spec.sections.filter((s) => s.requiredManual).map((s) => s.id);
    }
    if (spec && Array.isArray(spec.requiredManual)) return spec.requiredManual;
    return FALLBACK_REQUIRED_MANUAL[specialty] || [];
  }, [specialties, specialty]);

  const missingRequired = useMemo(() => {
    if (readOnly) return [];
    return requiredManualIds.filter(
      (id) => !(edits[id] || '').trim() && !(drafts[id] || '').trim()
    );
  }, [requiredManualIds, edits, drafts, readOnly]);

  const sections = useMemo(
    () =>
      sectionOrder.map((id) => ({
        id,
        title: titleFor(id),
        meta: sectionMeta[id] || {},
      })),
    [sectionOrder, sectionMeta]
  );

  const handleRegenerate = useCallback(
    async (sectionId) => {
      if (readOnly) return;
      setRegenState((s) => ({ ...s, [sectionId]: { loading: true, error: '' } }));
      // Send the full current state: doctor edits where present, drafts otherwise.
      const currentDraft = {};
      for (const id of sectionOrder) {
        currentDraft[id] = (edits[id] || '').trim() ? edits[id] : drafts[id] || '';
      }
      try {
        const res = await regenerateSection(dfnInput, sectionId, specialty, currentDraft);
        // Replace ONLY this section's draft. Never touch edits elsewhere.
        setDrafts((d) => ({ ...d, [sectionId]: res.text }));
        setRegenState((s) => ({ ...s, [sectionId]: { loading: false, error: '' } }));
      } catch (err) {
        setRegenState((s) => ({
          ...s,
          [sectionId]: { loading: false, error: err.message || 'Draft generation failed' },
        }));
        console.error('[App] regenerate failed:', err);
      }
    },
    [readOnly, dfnInput, specialty, sectionOrder, edits, drafts]
  );

  const handleEdit = useCallback((sectionId, text) => {
    setEdits((e) => ({ ...e, [sectionId]: text }));
  }, []);

  const handleApprove = useCallback(async () => {
    setApproving(true);
    setApproveError('');
    setApproveMissing([]);
    const finalSections = {};
    for (const id of sectionOrder) {
      finalSections[id] = (edits[id] || '').trim() ? edits[id] : drafts[id] || '';
    }
    try {
      const res = await approveSummary(dfnInput, specialty, finalSections, approvedBy.trim());
      setApproving(false);
      setApproved({
        sections: finalSections,
        approvedAt: res.approvedAt,
        approvedBy: approvedBy.trim(),
        specialty,
      });
      setJustApproved(true);
    } catch (err) {
      setApproving(false);
      setApproveError(err.message || 'Approve failed');
      // If the server rejects because requiredManual sections are empty, parse which ones.
      const msg = err.message || '';
      const missing = sectionOrder.filter(
        (id) => msg.toLowerCase().includes(id.toLowerCase()) && !(finalSections[id] || '').trim()
      );
      setApproveMissing(missing.length ? missing : requiredManualIds.filter((id) => !(finalSections[id] || '').trim()));
      console.error('[App] approve failed:', err);
    }
  }, [dfnInput, specialty, sectionOrder, edits, drafts, approvedBy, requiredManualIds]);

  const activeDraft = drafts[activeSection] || '';
  const activeEdit = edits[activeSection];
  const activeRegen = regenState[activeSection] || {};

  return (
    <div className="app">
      <div className="app-header">
        <span className="app-title">IPD · DISCHARGE SUMMARY</span>
        <span className="app-sub">AI-ASSISTED DRAFT — REVIEW BEFORE APPROVAL</span>
      </div>

      <PatientSelect
        dfn={dfnInput}
        onDfnChange={setDfnInput}
        specialty={specialty}
        onSpecialtyChange={(k) => {
          setSpecialty(k);
          // Reload with the new config if a patient is already loaded and not approved.
          if (patient && !approved) loadPatient(dfnInput, k);
        }}
        specialties={specialties}
        onLoad={() => {
          if (loading) return;
          loadPatient(dfnInput, specialty);
        }}
        loading={loading}
      />

      {patientError && <div className="banner banner-error">{patientError}</div>}

      {patient && (
        <PatientBanner patient={patient} approved={approved} justApproved={justApproved} />
      )}

      <div className="workspace">
        <SectionNav
          sections={sections}
          activeId={activeSection}
          onSelect={setActiveSection}
          requiredIds={requiredManualIds}
          missingIds={missingRequired}
          loading={draftLoading || patientLoading}
          readOnly={readOnly}
        />

        <div className="content">
          {patientLoading || draftLoading ? (
            <div className="panel-note">Loading patient data…</div>
          ) : draftError ? (
            <div className="panel-note panel-note-error">
              Draft generation failed — {draftError}
              <button type="button" className="btn" onClick={() => loadPatient(dfnInput, specialty)}>
                Retry
              </button>
            </div>
          ) : !activeSection ? (
            <div className="panel-note">No section selected.</div>
          ) : (
            <div className="section-panels">
              <DraftPanel
                title={(sections.find((s) => s.id === activeSection) || {}).title || activeSection}
                text={activeDraft}
                onRegenerate={() => handleRegenerate(activeSection)}
                regenLoading={activeRegen.loading}
                regenError={activeRegen.error}
                readOnly={readOnly}
              />
              <EditPanel
                sectionId={activeSection}
                value={activeEdit !== undefined ? activeEdit : activeDraft}
                onChange={handleEdit}
                readOnly={readOnly}
                edited={activeEdit !== undefined && activeEdit !== activeDraft}
              />
            </div>
          )}
        </div>
      </div>

      {(patient || approved) && (
        <ApproveBar
          approvedBy={approvedBy}
          onApprovedByChange={setApprovedBy}
          onApprove={handleApprove}
          approving={approving}
          approveError={approveError}
          missingRequired={missingRequired.map((id) => titleFor(id))}
          approveMissing={approveMissing.map((id) => titleFor(id))}
          readOnly={readOnly}
          approvedInfo={approved ? { approvedAt: approved.approvedAt, approvedBy: approved.approvedBy } : null}
        />
      )}
    </div>
  );
}
