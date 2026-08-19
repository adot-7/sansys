// Test fixture only — live-shaped responses for the 11 documented Sansys read
// endpoints, mirroring server/src/sansys-api.md. Kept out of production code.
// Values are the documented sample patient (PAT123456) from the product brief.

export default {
  demographics: {
    success: true,
    data: {
      lfname: 'Rohit',
      llname: 'Sharma',
      lsex: 'Male',
      dob: '1979-04-12',
      lage: '47',
      cpPID: 'UHID0098712',
      cpIPNo: 'IP-2026-44310',
      ward: 'B-Wing 4F',
      admdt: '2026-08-01 09:30',
      pphy: 'Dr. A. Menon',
      DisDate: '',
    },
  },

  clinicalNotes: {
    success: true,
    data: {
      notes: [
        { note_ien: 'N-9001', note_title: 'Admission Note', date_of_entry: '2026-08-01 11:05', status_name: 'COMPLETED', author_name: 'Dr. A. Menon' },
        { note_ien: 'N-9002', note_title: 'Dermatology Consult', date_of_entry: '2026-08-02 16:40', status_name: 'COMPLETED', author_name: 'Dr. S. Iyer' },
        { note_ien: 'N-9003', note_title: 'Ward Round Note', date_of_entry: '2026-08-05 08:20', status_name: 'COMPLETED', author_name: 'Dr. A. Menon' },
        { note_ien: 'N-9004', note_title: 'Progress Note', date_of_entry: '2026-08-08 14:55', status_name: 'SIGNED', author_name: 'Dr. R. Kulkarni' },
      ],
    },
  },

  labs: {
    success: true,
    data: {
      orders: [
        { itemOrdered: 'CBC with Differential', section: 'Haematology', orderDateTime: '2026-08-01 10:15', status: { name: 'COMPLETED' } },
        { itemOrdered: 'HbA1c', section: 'Biochemistry', orderDateTime: '2026-08-01 10:15', status: { name: 'COMPLETED' } },
        { itemOrdered: 'Serum Creatinine', section: 'Biochemistry', orderDateTime: '2026-08-02 07:45', status: { name: 'COMPLETED' } },
        { itemOrdered: 'Lipid Profile', section: 'Biochemistry', orderDateTime: '2026-08-03 09:00', status: { name: 'COMPLETED' } },
        { itemOrdered: 'CRP', section: 'Immunology', orderDateTime: '2026-08-05 06:30', status: { name: 'COMPLETED' } },
        { itemOrdered: 'Serum Electrolytes', section: 'Biochemistry', orderDateTime: '2026-08-07 06:30', status: { name: 'PENDING' } },
      ],
    },
  },

  radiology: {
    success: true,
    data: {
      orders: [
        { imaging_procedure: 'Chest X-Ray PA', imaging_type: 'X-Ray', status: 'COMPLETED', start_date_time: '2026-08-01 12:40' },
        { imaging_procedure: 'CT Chest with Contrast', imaging_type: 'CT', status: 'COMPLETED', start_date_time: '2026-08-04 15:10' },
        { imaging_procedure: 'Doppler Bilateral Lower Limbs', imaging_type: 'Ultrasound', status: 'SCHEDULED', start_date_time: '2026-08-09 10:00' },
      ],
    },
  },

  vitals: {
    success: true,
    data: {
      vitals: [
        {
          date_time: '2026-08-01 09:45',
          measurements: {
            'BLOOD PRESSURE': { value: '148/92', bgColor: 'red' },
            TEMPERATURE: { value: '38.4', bgColor: 'red' },
            PULSE: { value: '96' },
            'PULSE OXIMETRY': { value: '95', bgColor: 'red' },
          },
        },
        {
          date_time: '2026-08-02 08:00',
          measurements: {
            'BLOOD PRESSURE': { value: '140/88', bgColor: 'red' },
            TEMPERATURE: { value: '37.8', bgColor: 'red' },
            PULSE: { value: '92' },
            'PULSE OXIMETRY': { value: '96' },
          },
        },
        {
          date_time: '2026-08-04 07:50',
          measurements: {
            'BLOOD PRESSURE': { value: '134/84' },
            TEMPERATURE: { value: '37.2' },
            PULSE: { value: '88' },
            'PULSE OXIMETRY': { value: '97' },
          },
        },
        {
          date_time: '2026-08-06 20:15',
          measurements: {
            'BLOOD PRESSURE': { value: '150/95', bgColor: 'red' },
            TEMPERATURE: { value: '36.9' },
            PULSE: { value: '104', bgColor: 'red' },
            'PULSE OXIMETRY': { value: '94', bgColor: 'red' },
          },
        },
        {
          date_time: '2026-08-09 07:30',
          measurements: {
            'BLOOD PRESSURE': { value: '128/80' },
            TEMPERATURE: { value: '36.8' },
            PULSE: { value: '84' },
            'PULSE OXIMETRY': { value: '98' },
          },
        },
      ],
      admissions: [{ id: '2-4', displayName: 'Ward admission' }],
    },
  },

  problems: {
    success: true,
    data: {
      problems: [
        { problem: 'Plaque psoriasis, widespread', status: 'ACTIVE', dateOnset: '2026-08-01', comorbidity: false },
        { problem: 'Type 2 diabetes mellitus', status: 'ACTIVE', dateOnset: '2015-06-20', comorbidity: true },
        { problem: 'Essential hypertension', status: 'ACTIVE', dateOnset: '2012-03-14', comorbidity: true },
        { problem: 'Atopic eczema', status: 'INACTIVE', dateOnset: '2008-11-02', comorbidity: true },
        { problem: 'Dyslipidaemia', status: 'ACTIVE', dateOnset: '2019-01-25', comorbidity: true },
      ],
    },
  },

  diagnosis: {
    success: true,
    data: {
      diagnoses: [
        { diagnosis: 'Erythrodermic psoriasis flare', isPrimary: true, type: 'Primary', dateEntered: '2026-08-01 10:00' },
        { diagnosis: 'Type 2 diabetes mellitus, uncontrolled', isPrimary: false, type: 'Secondary', dateEntered: '2026-08-01 10:05' },
        { diagnosis: 'Essential hypertension', isPrimary: false, type: 'Secondary', dateEntered: '2026-08-01 10:05' },
        { diagnosis: 'Acute bronchitis', isPrimary: false, type: 'Secondary', dateEntered: '2026-08-03 09:20' },
      ],
    },
  },

  chiefComplaints: {
    success: true,
    data: {
      complaints: [
        { complaint_name: 'Widespread redness and scaling of skin', complaint_type: 'Chief Complaint', remark: 'Progressive over 2 weeks, involving trunk and limbs with itching', date: '2026-08-01' },
        { complaint_name: 'Fever', complaint_type: 'Chief Complaint', remark: 'Low grade, on and off for 4 days before admission', date: '2026-08-01' },
        { complaint_name: 'Itching', complaint_type: 'Associated Complaint', remark: 'Severe at night, disturbing sleep', date: '2026-08-01' },
        { complaint_name: 'Joint pain', complaint_type: 'Associated Complaint', remark: 'Small joints of hands, worse in morning', date: '2026-08-01' },
        { complaint_name: 'Generalised weakness', complaint_type: 'Associated Complaint', remark: 'Since onset of skin flare, reduced oral intake', date: '2026-08-02' },
        { complaint_name: 'Dry cough', complaint_type: 'Associated Complaint', remark: 'Non-productive, 3 days', date: '2026-08-03' },
      ],
    },
  },

  allergies: {
    success: true,
    status: 'Known allergies',
    data: [
      { allergy: 'Sulfonamides', natureOfReaction: 'Drug', symptoms: 'Generalised rash and facial swelling', date: '2018-02-11' },
      { allergy: 'Shellfish', natureOfReaction: 'Food', symptoms: 'Urticaria and itching', date: '2010-07-19' },
    ],
  },

  medications: {
    success: true,
    data: {
      orders: [
        { medication_name: 'Methotrexate 15 mg weekly', start_date: '2026-08-02', stop_date: '', status: 'ACTIVE', schedule_type: 'Weekly' },
        { medication_name: 'Cetirizine 10 mg at bedtime', start_date: '2026-08-01', stop_date: '', status: 'ACTIVE', schedule_type: 'Nightly' },
        { medication_name: 'Paracetamol 650 mg as needed', start_date: '2026-08-01', stop_date: '', status: 'ACTIVE', schedule_type: 'PRN' },
        { medication_name: 'Human regular insulin sliding scale', start_date: '2026-08-02', stop_date: '', status: 'ACTIVE', schedule_type: 'TDS' },
        { medication_name: 'Emollient cream apply BD', start_date: '2026-08-01', stop_date: '', status: 'ACTIVE', schedule_type: 'BD' },
        { medication_name: 'Ceftriaxone 1 g IV OD', start_date: '2026-08-03', stop_date: '2026-08-06', status: 'COMPLETED', schedule_type: 'OD' },
        { medication_name: 'Ibuprofen 400 mg TDS', start_date: '2026-07-15', stop_date: '2026-08-04', status: 'DISCONTINUED', schedule_type: 'TDS' },
        { medication_name: 'Telmisartan 40 mg OD', start_date: '2026-07-10', stop_date: '', status: 'ACTIVE', schedule_type: 'OD' },
      ],
    },
  },
};