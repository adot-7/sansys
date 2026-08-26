import React, { useState } from 'react';

export default function SpecialtyModal({ onSave, onClose }) {
  const [label, setLabel] = useState('');
  const [sections, setSections] = useState([{ title: '', source: '', requiredManual: false }]);
  const [error, setError] = useState('');
  function update(index, field, value) {
    setSections((current) => current.map((section, i) => i === index ? { ...section, [field]: value } : section));
  }
  async function save(event) {
    event.preventDefault();
    try { await onSave({ label, sections }); } catch (err) { setError(err.message); }
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="settings-modal specialty-modal" onSubmit={save}>
        <div className="modal-header"><strong>NEW SPECIALTY</strong><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
        <div className="modal-form">
          <label className="field"><span className="field-label">SPECIALTY NAME</span><input className="input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Cardiology" required /></label>
          <div className="field-label">SECTIONS</div>
          {sections.map((section, index) => <div className="custom-section-row" key={index}>
            <input className="input" value={section.title} onChange={(event) => update(index, 'title', event.target.value)} placeholder="Section title" required />
            <input className="input" value={section.source} onChange={(event) => update(index, 'source', event.target.value)} placeholder="Patient data key (optional)" />
            <input className="input" value={section.endpoint || ''} onChange={(event) => update(index, 'endpoint', event.target.value)} placeholder="JSON endpoint/{dfn} (optional)" />
            <label className="section-check"><input type="checkbox" checked={section.requiredManual} onChange={(event) => update(index, 'requiredManual', event.target.checked)} /> Required manual</label>
          </div>)}
          <button type="button" className="btn btn-small" onClick={() => setSections((current) => [...current, { title: '', source: '', requiredManual: false }])}>+ Add field</button>
          {error && <div className="approve-error">{error}</div>}
          <div className="panel-note">Use a normalized key such as <code>diagnoses</code>, <code>medications</code>, <code>vitals</code>, or <code>allergies</code>. Alternatively provide a public JSON endpoint containing <code>{'{dfn}'}</code>. Leave both blank for doctor-entered text.</div>
        </div>
        <div className="modal-footer"><button type="submit" className="btn btn-primary">Create specialty</button></div>
      </form>
    </div>
  );
}
