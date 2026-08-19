# Sansys test API — actual endpoint shapes

This is the reference for the **external** Sansys test API (`SANSYS_BASE_URL`,
default `http://182.70.249.137:3030`). It is read by exactly one module:
`server/src/dataAccess.js`. When the API changes, update **this file first**,
then the field mappers in `dataAccess.js` and the test fixture in
`server/test/fixtures/patient.js`. The normalized internal contract (what the
rest of the app sees) lives in `server/src/contracts.md` and must not be touched
for API drifts.

General rules:

- No authentication on any endpoint. Read-only: we never call anything that
  writes.
- Patient identifiers are inconsistent across endpoints. Two distinct systems
  appear: `dfn` (e.g. `PAT123456`) and `patientIen`. Visit/admission ids also
  vary (`visit_id`, `admissionId`, `admissionIen`). They are **not**
  interchangeable — each endpoint documents which one it wants.
- Every live response is wrapped as `{ success, data }` with lists nested one
  level down (see each shape). Allergies puts `data` at the top level with a
  sibling `status`.
- The normalization layer is deliberately tolerant: a field that goes missing
  normalizes to `""` / empty array rather than crashing. A drifted shape shows
  up as empty sections in the UI — if that happens, diff against this file.

## 1. Demographics

- Method/URL: `GET /patientHome/load-demographics/:dfn?userId=1`
- Identifiers: path param `dfn`.

```jsonc
{
  "success": true,
  "data": {
    "lfname": "Rohit",          // first name
    "llname": "Sharma",         // last name
    "lsex": "Male",
    "dob": "1979-04-12",
    "lage": "47",
    "cpPID": "UHID0098712",     // UHID
    "cpIPNo": "IP-2026-44310",  // IP admission number
    "ward": "B-Wing 4F",
    "admdt": "2026-08-01 09:30",// admission datetime
    "pphy": "Dr. A. Menon",     // primary physician
    "DisDate": ""               // empty until discharge is finalized
  }
}
```

## 2. Clinical notes (list)

- Method/URL: `POST /clinical-notes/list`
- Identifiers: body `patient_dfn` (a `dfn`), `duz`.
- Body: `{ patient_dfn, duz, limit, offset, date_from, date_to, search_text, status_filter }`

```jsonc
{
  "success": true,
  "data": {
    "notes": [
      {
        "note_ien": "N-9001",
        "note_title": "Admission Note",
        "date_of_entry": "2026-08-01 11:05",
        "status_name": "COMPLETED",
        "author_name": "Dr. A. Menon"
      }
    ]
  }
}
```

## 3. Clinical note detail

- Method/URL: `GET /clinical-notes/view/:note_ien`
- Identifiers: path param `note_ien`.
- **Not part of the normalized contract.** `content` and `patient_objects`
  (vitals/allergies references) are usually empty in test data, so the app only
  surfaces list metadata from #2. Never mutated.

```jsonc
{
  "success": true,
  "data": {
    "content": "",
    "patient_objects": []
  }
}
```

## 4. Lab orders

- Method/URL: `POST /lab/list`
- Identifiers: body `dfn`, `visit_id`.
- Body: `{ dfn, status, visit_id, from_date, to_date }`

```jsonc
{
  "success": true,
  "data": {
    "orders": [
      {
        "itemOrdered": "CBC with Differential",
        "section": "Haematology",
        "orderDateTime": "2026-08-01 10:15",
        "status": { "name": "COMPLETED" }   // status is an object here
      }
    ]
  }
}
```

## 5. Radiology orders

- Method/URL: `POST /rad/cpoe-list`
- Identifiers: body `dfn`, `visit_id`.
- Body: `{ dfn, status, visit_id, from_date, to_date }`

```jsonc
{
  "success": true,
  "data": {
    "orders": [
      {
        "imaging_procedure": "Chest X-Ray PA",
        "imaging_type": "X-Ray",
        "status": "COMPLETED",              // status is a string here
        "start_date_time": "2026-08-01 12:40"
      }
    ]
  }
}
```

## 6. Vitals

- Method/URL: `GET /vitals/dash/load/:dfn?fromDate=&toDate=&admissionId=&range=1`
- Identifiers: path param `dfn`, query `admissionId` (only when retrying).
- The first call (no `admissionId`) may return an empty `vitals` array but a
  populated `admissions` list; dataAccess then retries once with
  `admissionId` set to `admissions[0].id`.

```jsonc
{
  "success": true,
  "data": {
    "vitals": [
      {
        "date_time": "2026-08-01 09:45",
        "measurements": {
          "BLOOD PRESSURE": { "value": "148/92", "unit": "mmHg", "bgColor": "red" },
          "TEMPERATURE":   { "value": "38.4", "unit": "°C", "bgColor": "red" },
          "PULSE":         { "value": "96" },
          "PULSE OXIMETRY":{ "value": "95", "bgColor": "red" }
        }
      }
    ],
    "admissions": [
      { "id": "2-4", "displayName": "Ward admission" }
    ]
  }
}
```

- Measurements are an object **keyed by vital name**. `bgColor` present is
  treated as "flagged abnormal" (the API has no explicit abnormal flag).
- Normalization keys vitals by name (`BLOOD PRESSURE` → `blood pressure`) and
  drops entries whose value is empty or `"not entered"`.

## 7. Problem list

- Method/URL: `POST /problems/dash-list`
- Identifiers: body `dfn`, `visit_id`.
- Body: `{ dfn, status, visit_id }`

```jsonc
{
  "success": true,
  "data": {
    "problems": [
      {
        "problem": "Plaque psoriasis, widespread",
        "status": "ACTIVE",
        "dateOnset": "2026-08-01",
        "comorbidity": false
      }
    ]
  }
}
```

## 8. Diagnosis

- Method/URL: `POST /diagnosis/dash/list`
- Identifiers: body `dfn`, `visit_id`, `duz`.
- Body: `{ dfn, visit_id, duz }`

```jsonc
{
  "success": true,
  "data": {
    "diagnoses": [
      {
        "diagnosis": "Erythrodermic psoriasis flare",
        "isPrimary": true,
        "type": "Primary",          // "Primary" | "Secondary"
        "dateEntered": "2026-08-01 10:00"
      }
    ]
  }
}
```

- Normalization sorts primary diagnoses first, preserving API order within
  each group.

## 9. Chief complaints

- Method/URL: `GET /chiefcomplaint/dash-list/:patientIen?status=1&admissionIen=1`
- Identifiers: path param `patientIen` (**not** `dfn`), query `admissionIen`.
- The documented sample uses `patientIen=1`, `admissionIen=1`.

```jsonc
{
  "success": true,
  "data": {
    "complaints": [
      {
        "complaint_name": "Widespread redness and scaling of skin",
        "complaint_type": "Chief Complaint",  // "Chief Complaint" | "Associated Complaint"
        "remark": "Progressive over 2 weeks, involving trunk and limbs with itching",
        "date": "2026-08-01"
      }
    ]
  }
}
```

## 10. Allergies

- Method/URL: `GET /allergies/dashboard-list/:patientIen`
- Identifiers: path param `patientIen` (**not** `dfn`).
- Note the shape differs from every other endpoint: `data` is the array itself
  (not nested under `data`), and `status` is a top-level sibling.

```jsonc
{
  "success": true,
  "status": "Known allergies",      // e.g. "Known allergies" | "NKA"
  "data": [
    {
      "allergy": "Sulfonamides",
      "natureOfReaction": "Drug",   // "Drug" | "Food" | ...
      "symptoms": "Generalised rash and facial swelling",
      "date": "2018-02-11"
    }
  ]
}
```

## 11. Medications

- Method/URL: `POST /med/list?dfn=PAT123456`
- Identifiers: `dfn` in **both** the query string and the body.
- Body: `{ dfn, status, schedule_type, visit_id, from_date, to_date }`

```jsonc
{
  "success": true,
  "data": {
    "orders": [
      {
        "medication_name": "Methotrexate 15 mg weekly",
        "start_date": "2026-08-02",
        "stop_date": "",
        "status": "ACTIVE",           // "ACTIVE" | "COMPLETED" | "DISCONTINUED" | ...
        "schedule_type": "Weekly"     // "Weekly" | "Nightly" | "PRN" | "TDS" | "OD" | ...
      }
    ]
  }
}
```

## Keeping dataAccess.js in sync

1. When a Sansys field changes, edit the corresponding response sample above.
2. The `map*` / `normalize*` helpers in `dataAccess.js` are the only place that
   read these raw fields — update them to match.
3. Mirror the change in `server/test/fixtures/patient.js` and run
   `npm test` in `server/`.
4. Do not change `server/src/contracts.md` — that is the normalized object the
   rest of the app depends on and is stable on purpose.
