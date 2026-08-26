import React from 'react';

export default function PrintSummary({ patient, approved, sections }) {
  const demographics = patient?.demographics || {};
  const name = [demographics.firstName, demographics.lastName].filter(Boolean).join(' ') || '—';
  return <div className="print-summary">
    <h1>DISCHARGE SUMMARY</h1>
    <div className="print-patient"><strong>{name}</strong><span>UHID: {demographics.uhid || '—'}</span><span>IP NO: {demographics.ipNo || '—'}</span><span>AGE / SEX: {demographics.age || '—'} / {demographics.sex || '—'}</span></div>
    <div className="print-meta">SPECIALTY: {approved?.specialty || '—'} | APPROVED BY: {approved?.approvedBy || '—'} | {approved?.approvedAt || ''}</div>
    {sections.map((section) => <section className="print-section" key={section.id}><h2>{section.title}</h2><div>{approved?.sections?.[section.id] || '—'}</div></section>)}
  </div>;
}
