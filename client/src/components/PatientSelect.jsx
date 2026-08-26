import React from 'react';

export default function PatientSelect({
  dfn,
  onDfnChange,
  specialty,
  onSpecialtyChange,
  specialties,
  onLoad,
  loading,
  onSettings,
}) {
  return (
    <div className="toolbar">
      <label className="field">
        <span className="field-label">PATIENT DFN</span>
        <input
          type="text"
          className="input input-mono"
          value={dfn}
          onChange={(e) => onDfnChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onLoad();
          }}
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span className="field-label">SPECIALTY</span>
        <select className="input" value={specialty} onChange={(e) => onSpecialtyChange(e.target.value)}>
          {specialties.length === 0 && <option value="general">General</option>}
          {specialties.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onLoad}
        disabled={loading}
        title="Load patient"
      >
        {loading ? 'Loading…' : 'Load Patient'}
      </button>
      <button type="button" className="btn" onClick={onSettings} title="Choose specialty sections">
        Settings
      </button>
      <span className="toolbar-hint">Draft generates automatically after load</span>
    </div>
  );
}
