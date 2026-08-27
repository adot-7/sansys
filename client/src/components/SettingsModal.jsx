import React, { useMemo, useState } from 'react';

export default function SettingsModal({ specialties, specialty, selectedIds, onDone, onCreate, onClose }) {
  const [activeKey, setActiveKey] = useState(specialty);
  const [checked, setChecked] = useState(selectedIds);
  const active = useMemo(() => specialties.find((item) => item.key === activeKey), [specialties, activeKey]);

  function toggle(id) {
    setChecked((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header"><strong id="settings-title">SUMMARY SETTINGS</strong><button className="btn btn-small" onClick={onClose}>Close</button></div>
        <div className="settings-body">
          <div className="settings-specialties">
            <div className="field-label">SPECIALTY</div>
            {specialties.map((item) => (
              <button key={item.key} className={'settings-specialty' + (item.key === activeKey ? ' settings-specialty-active' : '')} onClick={() => { setActiveKey(item.key); setChecked(item.sections.map((section) => section.id)); }}>
                {item.label}
              </button>
            ))}
            <button className="btn btn-small settings-add" onClick={onCreate}>+ New specialty</button>
          </div>
          <div className="settings-sections">
            <div className="settings-sections-header">
              <div className="field-label">INCLUDE SECTIONS IN THIS SESSION</div>
              <div className="settings-section-actions">
                <button type="button" className="btn btn-small" onClick={() => setChecked((active?.sections || []).map((section) => section.id))}>Select all</button>
                <button type="button" className="btn btn-small" onClick={() => setChecked([])}>Select none</button>
              </div>
            </div>
            {active?.sections.map((section) => (
              <label className="section-check" key={section.id}>
                <input type="checkbox" checked={checked.includes(section.id)} onChange={() => toggle(section.id)} />
                <span>{section.title}</span>
              </label>
            ))}
            {!active && <div className="panel-note">No specialty selected.</div>}
          </div>
        </div>
        <div className="modal-footer"><span className="toolbar-hint">Changes apply when you click Done.</span><button className="btn btn-primary" disabled={!active || checked.length === 0} onClick={() => onDone(activeKey, checked)}>Done</button></div>
      </div>
    </div>
  );
}
