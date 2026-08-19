import React from 'react';

export default function PatientBanner({ patient, approved, justApproved }) {
  const d = patient.demographics || {};
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ') || '—';
  const allergyItems = (patient.allergies && patient.allergies.items) || [];
  const hasAllergies = allergyItems.length > 0;
  const allergyText = hasAllergies
    ? allergyItems.map((a) => a.allergy).filter(Boolean).join(', ')
    : 'NKA';

  return (
    <div className="patient-banner">
      {justApproved && (
        <div className="approve-confirm">
          SUMMARY APPROVED AND SAVED — READ ONLY FOR THIS SESSION
        </div>
      )}
      {approved && !justApproved && (
        <div className="approve-confirm">
          APPROVED {approved.approvedAt || ''} BY {approved.approvedBy || '—'} — READ ONLY
        </div>
      )}
      <div className="banner-row">
        <div className="banner-cell">
          <span className="field-label">PATIENT</span>
          <span className="banner-value">{name}</span>
        </div>
        <div className="banner-cell">
          <span className="field-label">UHID</span>
          <span className="banner-value banner-mono">{d.uhid || '—'}</span>
        </div>
        <div className="banner-cell">
          <span className="field-label">IP NO</span>
          <span className="banner-value banner-mono">{d.ipNo || '—'}</span>
        </div>
        <div className="banner-cell">
          <span className="field-label">AGE / SEX</span>
          <span className="banner-value banner-mono">
            {d.age || '—'} / {d.sex || '—'}
          </span>
        </div>
        <div className="banner-cell">
          <span className="field-label">WARD</span>
          <span className="banner-value">{d.ward || '—'}</span>
        </div>
        <div className="banner-cell">
          <span className="field-label">ADM. DOCTOR</span>
          <span className="banner-value">{d.primaryPhysician || '—'}</span>
        </div>
        <div className="banner-cell">
          <span className="field-label">ADMIT DATE</span>
          <span className="banner-value banner-mono">{d.admitDate || '—'}</span>
        </div>
        <div className="banner-cell banner-cell-grow">
          <span className="field-label">ALLERGIES</span>
          <span className={hasAllergies ? 'allergy-chip' : 'allergy-chip allergy-chip-none'}>
            {hasAllergies ? 'ALLERGIES: ' + allergyText : 'NKA'}
          </span>
        </div>
      </div>
    </div>
  );
}
