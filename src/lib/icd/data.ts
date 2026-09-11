/**
 * Built-in ICD-10-CM dataset (curated subset for offline fallback).
 * Used by the Vector DB when the NLM API is unreachable, to seed the vector
 * index, and by the Validation Engine for 7th-character requirements.
 *
 * v0.3: expanded from ~70 to 400+ curated codes covering the most common
 * conditions seen in primary care / ER / follow-up encounters, organized
 * by ICD-10-CM chapter. The NLM API still provides the full 70k+ dataset
 * at runtime when online.
 */

export interface ICDEntry {
  code: string;
  description: string;
  /** Broad category — chapter-level grouping for faceted display */
  category: string;
  /** True if this code category requires a 7th character */
  requires_seventh_char?: boolean;
}

type Row = [code: string, description: string, seventh?: 1];

function chapter(category: string, rows: Row[]): ICDEntry[] {
  return rows.map(([code, description, seventh]) => ({
    code,
    description,
    category,
    ...(seventh ? { requires_seventh_char: true } : {}),
  }));
}

export const BUILTIN_ICD10: ICDEntry[] = [
  // =========================================================================
  // Chapter 20 — External causes of morbidity (V/W/X/Y) — supplemental only
  // =========================================================================
  ...chapter("External Causes", [
    // Bites / contact with animals
    ["W55.01XA", "Bitten by cat, initial encounter", 1],
    ["W55.01XD", "Bitten by cat, subsequent encounter", 1],
    ["W55.02XA", "Struck by cat, initial encounter", 1],
    ["W55.03XA", "Other contact with cat, initial encounter", 1],
    ["W55.03XD", "Other contact with cat, subsequent encounter", 1],
    ["W55.03XS", "Other contact with cat, sequela", 1],
    ["W54.0XXA", "Bitten by dog, initial encounter", 1],
    ["W54.0XXD", "Bitten by dog, subsequent encounter", 1],
    ["W54.0XXS", "Bitten by dog, sequela", 1],
    ["W56.22XA", "Struck by other marine mammal, initial encounter", 1],
    ["W57.XXXA", "Bitten or stung by nonvenomous insect and other nonvenomous arthropods, initial encounter", 1],
    // Falls
    ["W19.XXXA", "Unspecified fall, initial encounter", 1],
    ["W19.XXXD", "Unspecified fall, subsequent encounter", 1],
    ["W19.XXXS", "Unspecified fall, sequela", 1],
    ["W01.XXXA", "Fall on same level from slipping, tripping and stumbling without subsequent striking against object, initial encounter", 1],
    ["W01.XXXD", "Fall on same level from slipping, tripping and stumbling, subsequent encounter", 1],
    ["W18.XXXA", "Other fall on the same level, initial encounter", 1],
    ["W10.XXXA", "Fall on and from stairs and steps, initial encounter", 1],
    ["W11.XXXA", "Fall on and from ladder, initial encounter", 1],
    ["W17.XXXA", "Other fall from one level to another, initial encounter", 1],
    ["W06.XXXA", "Fall from bed, initial encounter", 1],
    ["W07.XXXA", "Fall from chair, initial encounter", 1],
    ["W08.XXXA", "Fall from toilet, initial encounter", 1],
    ["W18.22XA", "Other fall on the same level due to collision with, or pushing by, another person, initial encounter", 1],
    // Striking / cutting objects
    ["W20.XXXA", "Struck by thrown, projected or falling object, initial encounter", 1],
    ["W22.XXXA", "Struck against other object, initial encounter", 1],
    ["W23.XXXA", "Caught, crushed, jammed or pinched in or between objects, initial encounter", 1],
    ["W25.XXXA", "Contact with sharp glass, initial encounter", 1],
    ["W26.XXXA", "Contact with other sharp object, initial encounter", 1],
    ["W29.XXXA", "Contact with other powered hand tools and household machinery, initial encounter", 1],
    ["W31.XXXA", "Contact with other machinery, initial encounter", 1],
    // Transport
    ["V89.2XXA", "Person injured in unspecified motor-vehicle accident, traffic, initial encounter", 1],
    ["V49.9XXA", "Car occupant (driver/passenger) injured in unspecified traffic accident, initial encounter", 1],
    ["V09.2XXA", "Pedestrian injured in unspecified traffic accident, initial encounter", 1],
    ["V19.9XXA", "Pedal cyclist (driver/passenger) injured in unspecified traffic accident, initial encounter", 1],
    ["V29.9XXA", "Motorcycle rider injured in unspecified traffic accident, initial encounter", 1],
    // Fire / heat / electricity
    ["X00.XXXA", "Exposure to uncontrolled fire in building or structure, initial encounter", 1],
    ["X10.1XXA", "Contact with hot water, initial encounter", 1],
    ["X11.XXXA", "Contact with hot drinks, initial encounter", 1],
    ["X19.XXXA", "Exposure to other hot smoke, fire and flames, initial encounter", 1],
    ["X30.XXXA", "Exposure to excessive natural heat, initial encounter", 1],
    ["X31.XXXA", "Exposure to excessive natural cold, initial encounter", 1],
    ["W85.XXXA", "Exposure to electric transmission lines and cables, initial encounter", 1],
    ["W86.XXXA", "Exposure to other specified electric current, initial encounter", 1],
    // Venomous / poisoning
    ["X20.XXXA", "Contact with and (suspected) exposure to venomous snakes and lizards, initial encounter", 1],
    ["X21.XXXA", "Contact with and (suspected) exposure to venomous spiders, initial encounter", 1],
    ["X23.XXXA", "Contact with and (suspected) exposure to hornets, wasps and bees, initial encounter", 1],
    ["X40.XXXA", "Accidental poisoning by and exposure to nonopioid analgesics, antipyretics and antirheumatics, initial encounter", 1],
    ["X41.XXXA", "Accidental poisoning by and exposure to antiepileptic and sedative-hypnotic drugs, initial encounter", 1],
    ["X42.XXXA", "Accidental poisoning by and exposure to narcotics and psychodysleptics, initial encounter", 1],
    ["X44.XXXA", "Accidental poisoning by and exposure to other and unspecified drugs, medicaments and biological substances, initial encounter", 1],
    ["X45.XXXA", "Accidental poisoning by and exposure to alcohol, initial encounter", 1],
    ["X49.XXXA", "Accidental poisoning by and exposure to other and unspecified chemicals, initial encounter", 1],
    ["X59.XXXA", "Exposure to unspecified factor, initial encounter", 1],
    // Assault / other
    ["X99.XXXA", "Assault by sharp object, initial encounter", 1],
    ["Y08.XXXA", "Assault by other specified means, initial encounter", 1],
    // Place of occurrence
    ["Y92.008", "Unspecified place in single-family (private) house as the place of occurrence of the external cause"],
    ["Y92.01", "Driveway of single-family (private) house as the place of occurrence of the external cause"],
    ["Y92.02", "Garden or yard of single-family (private) house as the place of occurrence of the external cause"],
    ["Y92.09", "Other place in single-family (private) house as the place of occurrence of the external cause"],
    ["Y92.41", "School, other institution and public administrative area as the place of occurrence of the external cause"],
    ["Y92.46", "Sports and athletics area as the place of occurrence of the external cause"],
    ["Y92.51", "Street and highway as the place of occurrence of the external cause"],
    ["Y92.83", "Farm building as the place of occurrence of the external cause"],
    ["Y92.22", "Mine and quarry as the place of occurrence of the external cause"],
    ["Y92.241", "Emergency room and outpatient department of hospital as the place of occurrence of the external cause"],
    ["Y92.25", "Health care facility, outpatient, as the place of occurrence of the external cause"],
    // Activity
    ["Y93.A1", "Activity, walking"],
    ["Y93.A2", "Activity, running"],
    ["Y93.A3", "Activity, swimming"],
    ["Y93.A4", "Activity, cycling"],
    ["Y93.B1", "Activity, handtool use"],
    ["Y93.E1", "Activity, cooking"],
    ["Y93.F1", "Activity, cleaning, scrubbing and vacuuming"],
    // External cause status
    ["Y99.0", "Civilian activity done for income or pay as the external cause status"],
    ["Y99.8", "Other specified external cause status"],
  ]),

  // =========================================================================
  // Chapter 19 — Injury, poisoning (S/T)
  // =========================================================================
  ...chapter("Injury — Head & Spine", [
    ["S00.161A", "Contusion of left cheek and temporomandibular area, initial encounter", 1],
    ["S01.01XA", "Laceration without foreign body of scalp, initial encounter", 1],
    ["S06.0X0A", "Concussion without loss of consciousness, initial encounter", 1],
    ["S06.0X1A", "Concussion with loss of consciousness of 30 minutes or less, initial encounter", 1],
    ["S06.0X9A", "Concussion with loss of consciousness of unspecified duration, initial encounter", 1],
    ["S09.90XA", "Unspecified injury of head, initial encounter, without skull fracture", 1],
    ["S12.9XXA", "Unspecified fracture of unspecified parts of neck, initial encounter for closed fracture", 1],
    ["S22.41XA", "Multiple fractures of ribs, initial encounter for closed fracture", 1],
    ["S22.31XA", "Fracture of one rib, right side, initial encounter for closed fracture", 1],
    ["S22.32XA", "Fracture of one rib, left side, initial encounter for closed fracture", 1],
    ["S33.5XXA", "Sprain of lumbar ligaments, initial encounter", 1],
    ["S39.012A", "Strain of muscle, fascia and tendon of lower back, initial encounter", 1],
  ]),

  ...chapter("Injury — Upper Extremity", [
    ["S42.011A", "Fracture of unspecified part of right clavicle, initial encounter for closed fracture", 1],
    ["S42.012A", "Fracture of unspecified part of left clavicle, initial encounter for closed fracture", 1],
    ["S43.409A", "Sprain of unspecified part of unspecified shoulder girdle, initial encounter", 1],
    ["S42.301A", "Unspecified fracture of the shaft of the right humerus, initial encounter for closed fracture", 1],
    ["S42.302A", "Unspecified fracture of the shaft of the left humerus, initial encounter for closed fracture", 1],
    ["S52.501A", "Unspecified fracture of the lower end of the right radius, initial encounter for closed fracture", 1],
    ["S52.502A", "Unspecified fracture of the lower end of the left radius, initial encounter for closed fracture", 1],
    ["S63.509A", "Sprain of unspecified part of unspecified wrist, initial encounter", 1],
    ["S61.411A", "Laceration without foreign body, right hand, initial encounter", 1],
    ["S61.412A", "Laceration without foreign body, left hand, initial encounter", 1],
    ["S61.419A", "Laceration without foreign body, unspecified hand, initial encounter", 1],
    ["S60.01XA", "Abrasion of right wrist and hand, initial encounter", 1],
    ["S60.02XA", "Abrasion of left wrist and hand, initial encounter", 1],
    ["S60.09XA", "Abrasion of unspecified wrist and hand, initial encounter", 1],
    ["S60.319A", "Contusion of unspecified finger(s) with fingernail involvement, initial encounter", 1],
    ["G56.00", "Postmononeuropathy of unspecified upper limb (carpal tunnel)"],
  ]),

  ...chapter("Injury — Lower Extremity", [
    ["S72.001A", "Fracture of unspecified part of neck of right femur, initial encounter for closed fracture", 1],
    ["S72.002A", "Fracture of unspecified part of neck of left femur, initial encounter for closed fracture", 1],
    ["S72.009A", "Fracture of unspecified part of neck of unspecified femur, initial encounter for closed fracture", 1],
    ["S70.01XA", "Contusion of right hip, initial encounter", 1],
    ["S70.02XA", "Contusion of left hip, initial encounter", 1],
    ["S82.201A", "Unspecified fracture of shaft of right tibia, initial encounter for closed fracture", 1],
    ["S82.202A", "Unspecified fracture of shaft of left tibia, initial encounter for closed fracture", 1],
    ["S82.61XA", "Fracture of lateral malleolus of right ankle, initial encounter for closed fracture", 1],
    ["S82.62XA", "Fracture of lateral malleolus of left ankle, initial encounter for closed fracture", 1],
    ["S93.401A", "Unspecified sprain of right ankle, initial encounter", 1],
    ["S93.402A", "Unspecified sprain of left ankle, initial encounter", 1],
    ["S80.01XA", "Contusion of right lower leg, initial encounter", 1],
    ["S80.02XA", "Contusion of left lower leg, initial encounter", 1],
    ["S80.04XA", "Contusion of unspecified lower leg, initial encounter", 1],
    ["S81.811A", "Laceration without foreign body, right lower leg, initial encounter", 1],
    ["S81.812A", "Laceration without foreign body, left lower leg, initial encounter", 1],
    ["S81.001A", "Laceration without foreign body, right knee, initial encounter", 1],
    ["S81.011A", "Laceration without foreign body, right thigh, initial encounter", 1],
    ["S90.461A", "Insect bite (nonvenomous), right foot, initial encounter", 1],
    ["S90.462A", "Insect bite (nonvenomous), left foot, initial encounter", 1],
    ["S83.241A", "Tear of medial meniscus, current injury, right knee, initial encounter", 1],
    ["S83.242A", "Tear of medial meniscus, current injury, left knee, initial encounter", 1],
  ]),

  ...chapter("Injury — General & Poisoning", [
    ["T14.90XA", "Injury, unspecified, initial encounter", 1],
    ["T15.01XA", "Foreign body in cornea, right eye, initial encounter", 1],
    ["T20.59XA", "Burn of other degree of head, face, and neck, initial encounter", 1],
    ["T21.39XA", "Burn of third degree of trunk, initial encounter", 1],
    ["T22.329A", "Burn of second degree of upper limb, except wrist and hand, initial encounter", 1],
    ["T25.221A", "Burn of second degree of right foot, initial encounter", 1],
    ["T30.0", "Burn of unspecified body region, unspecified degree"],
    ["T78.40XA", "Anaphylactic reaction, unspecified, initial encounter", 1],
    ["T39.011A", "Poisoning by salicylates, accidental, initial encounter", 1],
    ["T39.1X1A", "Poisoning by 4-aminophenol derivatives (acetaminophen), accidental, initial encounter", 1],
    ["T40.1X1A", "Poisoning by heroin, accidental, initial encounter", 1],
    ["T40.4X1A", "Poisoning by other synthetic narcotics, accidental, initial encounter", 1],
    ["T42.4X1A", "Poisoning by benzodiazepines, accidental, initial encounter", 1],
    ["T43.22X1A", "Poisoning by selective serotonin reuptake inhibitors, accidental, initial encounter", 1],
    ["T50.9X1A", "Poisoning by other and unspecified drugs, medicaments and biological substances, accidental, initial encounter", 1],
    ["T58.XX1A", "Toxic effect of carbon monoxide, accidental, initial encounter", 1],
    ["T81.40XA", "Infection following a procedure, initial encounter", 1],
  ]),

  // =========================================================================
  // Chapter 1 — Infectious & parasitic (A00-B99)
  // =========================================================================
  ...chapter("Infectious", [
    ["A09", "Infectious gastroenteritis and colitis, unspecified"],
    ["A41.9", "Sepsis, unspecified organism"],
    ["A41.01", "Sepsis due to Methicillin resistant Staphylococcus aureus"],
    ["A54.9", "Gonococcal infection, unspecified"],
    ["B00.9", "Herpesviral infection, unspecified"],
    ["B01.9", "Varicella without complication"],
    ["B18.9", "Unspecified viral hepatitis without hepatic coma"],
    ["B20", "Human immunodeficiency virus [HIV] disease"],
    ["B21", "Human immunodeficiency virus disease resulting in infectious and parasitic diseases"],
    ["B34.9", "Viral infection, unspecified"],
    ["B35.4", "Tinea corporis"],
    ["B95.4", "Streptococcus, group A, as the cause of diseases classified elsewhere"],
    ["B97.2", "Coronavirus as the cause of diseases classified elsewhere"],
    ["U07.1", "COVID-19, virus identified"],
    ["Z21", "Asymptomatic human immunodeficiency virus infection status"],
    ["Z20.9", "Contact with and (suspected) exposure to unspecified communicable disease"],
  ]),

  // =========================================================================
  // Chapter 2 — Neoplasms (C00-D49) — small curated set
  // =========================================================================
  ...chapter("Neoplasms", [
    ["C50.911", "Malignant neoplasm of unspecified site of unspecified female breast"],
    ["C34.90", "Malignant neoplasm of unspecified part of unspecified bronchus or lung"],
    ["C61", "Malignant neoplasm of prostate"],
    ["C64.9", "Malignant neoplasm of unspecified part of unspecified kidney"],
    ["C18.9", "Malignant neoplasm of colon, unspecified"],
    ["Z85.9", "Personal history of unspecified malignant neoplasm"],
  ]),

  // =========================================================================
  // Chapter 3 — Blood (D50-D89)
  // =========================================================================
  ...chapter("Blood", [
    ["D62", "Acute posthemorrhagic anemia"],
    ["D63.1", "Anemia in chronic kidney disease"],
    ["D64.9", "Anemia, unspecified"],
    ["D56.9", "Thalassemia, unspecified"],
    ["D57.00", "Hb-SS disease without crisis"],
    ["D69.6", "Thrombocytopenia, unspecified"],
  ]),

  // =========================================================================
  // Chapter 4 — Endocrine, metabolic (E00-E89)
  // =========================================================================
  ...chapter("Endocrine", [
    ["E03.9", "Hypothyroidism, unspecified"],
    ["E05.90", "Thyrotoxicosis, unspecified without thyrotoxic crisis or storm"],
    ["E10.9", "Type 1 diabetes mellitus without complications"],
    ["E10.10", "Type 1 diabetes mellitus with ketoacidosis without coma"],
    ["E10.40", "Type 1 diabetes mellitus with diabetic neuropathy, unspecified"],
    ["E11.9", "Type 2 diabetes mellitus without complications"],
    ["E11.65", "Type 2 diabetes mellitus with hyperglycemia"],
    ["E11.40", "Type 2 diabetes mellitus with diabetic neuropathy, unspecified"],
    ["E11.42", "Type 2 diabetes mellitus with diabetic polyneuropathy"],
    ["E11.319", "Type 2 diabetes mellitus with unspecified diabetic retinopathy without macular edema"],
    ["E11.51", "Type 2 diabetes mellitus with diabetic peripheral angiopathy without gangrene"],
    ["E11.621", "Type 2 diabetes mellitus with foot ulcer"],
    ["E11.22", "Type 2 diabetes mellitus with diabetic chronic kidney disease"],
    ["E13.9", "Other specified diabetes mellitus without complications"],
    ["E16.2", "Hypoglycemia, unspecified"],
    ["E28.2", "Polycystic ovarian syndrome"],
    ["E55.9", "Vitamin D deficiency, unspecified"],
    ["E66.9", "Obesity, unspecified"],
    ["E66.01", "Morbid (severe) obesity due to excess calories"],
    ["E78.00", "Unspecified hypercholesterolemia"],
    ["E78.2", "Mixed hyperlipidemia"],
    ["E78.5", "Hyperlipidemia, unspecified"],
    ["E83.52", "Hypercalcemia"],
    ["E86.0", "Dehydration"],
    ["E87.6", "Hypokalemia"],
  ]),

  // =========================================================================
  // Chapter 9 — Circulatory (I00-I99)
  // =========================================================================
  ...chapter("Circulatory", [
    ["I10", "Essential (primary) hypertension"],
    ["I11.0", "Hypertensive heart disease with heart failure"],
    ["I11.9", "Hypertensive heart disease without heart failure"],
    ["I12.9", "Hypertensive chronic kidney disease with stage 1-4 or unspecified CKD"],
    ["I12.0", "Hypertensive chronic kidney disease with stage 5 end stage renal disease"],
    ["I15.9", "Secondary hypertension, unspecified"],
    ["I20.9", "Angina pectoris, unspecified"],
    ["I21.11", "ST elevation (STEMI) myocardial infarction involving left anterior descending coronary artery"],
    ["I21.4", "Non-ST elevation (NSTEMI) myocardial infarction"],
    ["I21.9", "Acute myocardial infarction, unspecified"],
    ["I25.10", "Atherosclerotic heart disease of native coronary artery without angina pectoris"],
    ["I26.99", "Other pulmonary embolism without acute cor pulmonale"],
    ["I35.0", "Nonrheumatic aortic (valve) stenosis"],
    ["I42.9", "Cardiomyopathy, unspecified"],
    ["I47.1", "Supraventricular tachycardia"],
    ["I48.91", "Unspecified atrial fibrillation"],
    ["I50.9", "Heart failure, unspecified"],
    ["I50.21", "Acute systolic (congestive) heart failure"],
    ["I50.23", "Acute on chronic systolic (congestive) heart failure"],
    ["I60.9", "Nontraumatic subarachnoid hemorrhage, unspecified"],
    ["I61.9", "Nontraumatic intracerebral hemorrhage, unspecified"],
    ["I63.9", "Cerebral infarction, unspecified"],
    ["I73.9", "Peripheral vascular disease, unspecified"],
    ["I80.2", "Phlebitis and thrombophlebitis of other deep vessels of lower extremities"],
    ["I82.909", "Acute embolism and thrombosis of unspecified vein"],
    ["I87.2", "Venous insufficiency (chronic) (peripheral)"],
    ["I95.9", "Hypotension, unspecified"],
    ["Z95.0", "Presence of cardiac pacemaker"],
  ]),

  // =========================================================================
  // Chapter 10 — Respiratory (J00-J99)
  // =========================================================================
  ...chapter("Respiratory", [
    ["J01.90", "Acute sinusitis, unspecified"],
    ["J02.9", "Acute pharyngitis, unspecified"],
    ["J03.90", "Acute otitis media, unspecified ear"],
    ["J06.9", "Acute upper respiratory infection, unspecified"],
    ["J11.1", "Influenza with other respiratory manifestations, virus not identified"],
    ["J12.9", "Viral pneumonia, unspecified"],
    ["J15.9", "Bacterial pneumonia, unspecified"],
    ["J18.9", "Pneumonia, unspecified organism"],
    ["J20.9", "Acute bronchitis, unspecified"],
    ["J21.9", "Acute bronchiolitis, unspecified"],
    ["J30.9", "Allergic rhinitis, unspecified"],
    ["J32.9", "Chronic sinusitis, unspecified"],
    ["J35.3", "Hypertrophy of tonsils"],
    ["J40", "Bronchitis, not specified as acute or chronic"],
    ["J43.9", "Emphysema, unspecified"],
    ["J44.0", "Chronic obstructive pulmonary disease with (acute) lower respiratory infection"],
    ["J44.1", "Chronic obstructive pulmonary disease with (acute) exacerbation"],
    ["J44.9", "Chronic obstructive pulmonary disease, unspecified"],
    ["J45.20", "Mild intermittent asthma, uncomplicated"],
    ["J45.30", "Mild persistent asthma, uncomplicated"],
    ["J45.40", "Moderate persistent asthma, uncomplicated"],
    ["J45.50", "Severe persistent asthma, uncomplicated"],
    ["J45.901", "Unspecified asthma with (acute) exacerbation"],
    ["J45.909", "Unspecified asthma, uncomplicated"],
    ["J80", "Acute respiratory distress syndrome"],
    ["J90", "Pleural effusion, not elsewhere classified"],
    ["J96.01", "Acute respiratory failure with hypoxia"],
    ["J96.91", "Unspecified respiratory failure"],
  ]),

  // =========================================================================
  // Chapter 11 — Digestive (K00-K95)
  // =========================================================================
  ...chapter("Digestive", [
    ["K21.0", "Gastro-esophageal reflux disease with esophagitis"],
    ["K21.9", "Gastro-esophageal reflux disease without esophagitis"],
    ["K25.9", "Gastric ulcer, unspecified as acute or chronic, without hemorrhage or perforation"],
    ["K26.9", "Duodenal ulcer, unspecified as acute or chronic, without hemorrhage or perforation"],
    ["K29.70", "Gastritis, unspecified, without bleeding"],
    ["K35.80", "Unspecified acute appendicitis"],
    ["K36", "Appendicitis, unspecified"],
    ["K40.90", "Unilateral inguinal hernia, without obstruction or gangrene, not specified as recurrent"],
    ["K52.9", "Noninfective gastroenteritis and colitis, unspecified"],
    ["K57.30", "Diverticulosis of large intestine without perforation or abscess without bleeding"],
    ["K57.32", "Diverticulitis of large intestine without perforation or abscess without bleeding"],
    ["K58.9", "Irritable bowel syndrome, without diarrhea and without constipation"],
    ["K59.00", "Constipation, unspecified"],
    ["K64.9", "Unspecified hemorrhoids"],
    ["K74.60", "Unspecified cirrhosis of liver"],
    ["K80.20", "Calculus of gallbladder without cholecystitis, without obstruction"],
    ["K81.9", "Cholecystitis, unspecified"],
    ["K85.90", "Acute pancreatitis without necrosis or infection, unspecified"],
    ["K90.0", "Celiac disease"],
    ["K92.1", "Melena"],
    ["K92.2", "Gastrointestinal hemorrhage, unspecified"],
  ]),

  // =========================================================================
  // Chapter 12 — Skin (L00-L99)
  // =========================================================================
  ...chapter("Skin", [
    ["L02.91", "Cutaneous abscess, unspecified"],
    ["L03.115", "Cellulitis of right lower limb"],
    ["L03.116", "Cellulitis of left lower limb"],
    ["L03.90", "Cellulitis, unspecified"],
    ["L20.9", "Atopic dermatitis, unspecified"],
    ["L21.9", "Seborrheic dermatitis, unspecified"],
    ["L22", "Diaper dermatitis"],
    ["L23.9", "Allergic contact dermatitis, unspecified cause"],
    ["L24.9", "Irritant contact dermatitis, unspecified cause"],
    ["L30.9", "Dermatitis, unspecified"],
    ["L40.0", "Psoriasis vulgaris"],
    ["L50.9", "Urticaria, unspecified"],
    ["L60.0", "Ingrowing nail"],
    ["L70.0", "Acne vulgaris"],
    ["L71.9", "Rosacea, unspecified"],
    ["L89.152", "Pressure ulcer of sacral region, stage 2"],
    ["L89.153", "Pressure ulcer of sacral region, stage 3"],
    ["L97.4", "Non-pressure chronic ulcer of heel and midfoot"],
    ["L97.9", "Non-pressure chronic ulcer of unspecified part of lower leg"],
  ]),

  // =========================================================================
  // Chapter 13 — Musculoskeletal (M00-M99)
  // =========================================================================
  ...chapter("Musculoskeletal", [
    ["M06.9", "Rheumatoid arthritis, unspecified"],
    ["M10.9", "Gout, unspecified"],
    ["M17.0", "Bilateral primary osteoarthritis of knee"],
    ["M17.11", "Unilateral primary osteoarthritis, right knee"],
    ["M17.12", "Unilateral primary osteoarthritis, left knee"],
    ["M19.90", "Unspecified osteoarthritis, unspecified site"],
    ["M20.11", "Hallux valgus (acquired), right foot"],
    ["M20.12", "Hallux valgus (acquired), left foot"],
    ["M25.511", "Pain in right shoulder"],
    ["M25.512", "Pain in left shoulder"],
    ["M25.519", "Pain in unspecified shoulder"],
    ["M25.551", "Pain in right hip"],
    ["M25.552", "Pain in left hip"],
    ["M25.559", "Pain in unspecified hip"],
    ["M25.561", "Pain in right knee"],
    ["M25.562", "Pain in left knee"],
    ["M25.569", "Pain in unspecified knee"],
    ["M25.571", "Pain in joints of right ankle and foot"],
    ["M25.572", "Pain in joints of left ankle and foot"],
    ["M25.579", "Pain in joints of unspecified ankle and foot"],
    ["M47.816", "Spondylosis without myelopathy or radiculopathy, lumbar region"],
    ["M51.26", "Other intervertebral disc displacement, lumbar region"],
    ["M54.50", "Low back pain, unspecified"],
    ["M54.51", "Vertebrogenic low back pain"],
    ["M54.5", "Low back pain"],
    ["M72.2", "Plantar fascial fibromatosis"],
    ["M75.100", "Unspecified rotator cuff tear or rupture of unspecified shoulder, not specified as traumatic"],
    ["M75.41", "Impingement syndrome of right shoulder"],
    ["M75.42", "Impingement syndrome of left shoulder"],
    ["M79.1", "Myalgia"],
    ["M79.601", "Pain in right leg"],
    ["M79.602", "Pain in left leg"],
    ["M79.609", "Pain in unspecified leg"],
    ["M79.671", "Pain in right foot"],
    ["M79.672", "Pain in left foot"],
    ["M79.679", "Pain in unspecified foot"],
    ["M79.7", "Fibromyalgia"],
    ["M81.80", "Other osteoporosis without current pathological fracture, unspecified site"],
  ]),

  // =========================================================================
  // Chapter 14 — Genitourinary (N00-N99)
  // =========================================================================
  ...chapter("Genitourinary", [
    ["N10", "Acute pyelonephritis"],
    ["N17.9", "Acute kidney failure, unspecified"],
    ["N18.2", "Chronic kidney disease, stage 2 (mild)"],
    ["N18.3", "Chronic kidney disease, stage 3-unspecified"],
    ["N18.31", "Chronic kidney disease, stage 3a"],
    ["N18.32", "Chronic kidney disease, stage 3b"],
    ["N18.4", "Chronic kidney disease, stage 4 (severe)"],
    ["N18.6", "End stage renal disease"],
    ["N18.9", "Chronic kidney disease, unspecified"],
    ["N19", "Unspecified kidney failure"],
    ["N20.0", "Calculus of kidney"],
    ["N20.1", "Calculus of ureter"],
    ["N23", "Renal colic, unspecified"],
    ["N30.00", "Acute cystitis without hematuria"],
    ["N39.0", "Urinary tract infection, site not specified"],
    ["N40.0", "Benign prostatic hyperplasia without lower urinary tract symptoms"],
    ["N40.1", "Benign prostatic hyperplasia with lower urinary tract symptoms"],
  ]),

  // =========================================================================
  // Chapter 5 — Mental & behavioral (F01-F99)
  // =========================================================================
  ...chapter("Mental", [
    ["F03.90", "Unspecified dementia, unspecified severity, without behavioral disturbance, psychotic disturbance, mood disturbance, and anxiety"],
    ["F10.10", "Alcohol abuse, uncomplicated"],
    ["F10.20", "Alcohol dependence, uncomplicated"],
    ["F11.20", "Opioid dependence, uncomplicated"],
    ["F17.210", "Nicotine dependence, cigarettes, uncomplicated"],
    ["F31.9", "Bipolar disorder, unspecified"],
    ["F32.9", "Major depressive disorder, single episode, unspecified"],
    ["F33.1", "Major depressive disorder, recurrent, moderate"],
    ["F33.9", "Major depressive disorder, recurrent, unspecified"],
    ["F41.1", "Generalized anxiety disorder"],
    ["F41.9", "Anxiety disorder, unspecified"],
    ["F43.10", "Post-traumatic stress disorder, unspecified"],
    ["F90.9", "Attention-deficit hyperactivity disorder, unspecified type"],
  ]),

  // =========================================================================
  // Chapter 6 — Nervous (G00-G99)
  // =========================================================================
  ...chapter("Nervous", [
    ["G20", "Parkinson's disease"],
    ["G30.9", "Alzheimer's disease, unspecified"],
    ["G35", "Multiple sclerosis"],
    ["G40.909", "Epilepsy, unspecified, not intractable, without status epilepticus"],
    ["G43.909", "Migraine, unspecified, not intractable, without status migrainosus"],
    ["G45.9", "Transient cerebral ischemic attack, unspecified"],
    ["G47.00", "Insomnia, unspecified"],
    ["G47.33", "Obstructive sleep apnea (adult) (pediatric)"],
    ["G62.9", "Polyneuropathy, unspecified"],
    ["G89.11", "Acute pain due to trauma"],
    ["G89.21", "Chronic pain due to trauma"],
    ["G89.29", "Other chronic pain"],
    ["G89.4", "Chronic pain syndrome"],
    ["G93.5", "Compression of brain"],
  ]),

  // =========================================================================
  // Chapter 16 — Symptoms & ill-defined (R00-R99)
  // =========================================================================
  ...chapter("Symptoms", [
    ["R00.0", "Tachycardia, unspecified"],
    ["R05.9", "Cough, unspecified"],
    ["R05.3", "Chronic cough"],
    ["R06.00", "Dyspnea, unspecified"],
    ["R06.02", "Shortness of breath"],
    ["R07.9", "Chest pain, unspecified"],
    ["R09.02", "Hypoxemia"],
    ["R10.11", "Right upper quadrant pain"],
    ["R10.13", "Epigastric pain"],
    ["R10.31", "Right lower quadrant pain"],
    ["R10.32", "Left lower quadrant pain"],
    ["R10.33", "Periumbilical pain"],
    ["R10.84", "Generalized abdominal pain"],
    ["R10.9", "Unspecified abdominal pain"],
    ["R11.0", "Nausea"],
    ["R11.2", "Nausea with vomiting, unspecified"],
    ["R13.10", "Dysphagia, unspecified"],
    ["R19.7", "Diarrhea, unspecified"],
    ["R30.9", "Dysuria, unspecified"],
    ["R31.9", "Hematuria, unspecified"],
    ["R33.9", "Urinary retention, unspecified"],
    ["R41.82", "Altered mental status, unspecified"],
    ["R42", "Dizziness and giddiness"],
    ["R50.9", "Fever, unspecified"],
    ["R51.9", "Headache, unspecified"],
    ["R53.83", "Other fatigue"],
    ["R55", "Syncope and collapse"],
    ["R60.9", "Edema, unspecified"],
    ["R69", "Unknown causes of morbidity"],
    ["R73.01", "Impaired fasting glucose"],
    ["R73.03", "Prediabetes"],
    ["R73.9", "Hyperglycemia, unspecified"],
  ]),

  // =========================================================================
  // Chapter 21 — Factors influencing health status (Z00-Z99)
  // =========================================================================
  ...chapter("Health Status", [
    ["Z00.00", "Encounter for general adult medical examination without abnormal findings"],
    ["Z00.129", "Encounter for routine child health examination with abnormal findings"],
    ["Z34.90", "Encounter for supervision of normal pregnancy, unspecified trimester"],
    ["Z48.00", "Encounter for change or removal of surgical wound dressing"],
    ["Z51.11", "Encounter for antineoplastic chemotherapy"],
    ["Z68.41", "Body mass index (BMI) 40.0-44.9, adult"],
    ["Z72.0", "Tobacco use"],
    ["Z79.01", "Long term (current) use of anticoagulants"],
    ["Z79.02", "Long term (current) use of antithrombotics/antiplatelets"],
    ["Z79.4", "Long term (current) use of insulin"],
    ["Z79.899", "Other long term (current) drug therapy"],
    ["Z85.9", "Personal history of unspecified malignant neoplasm"],
    ["Z86.718", "Personal history of venous thrombosis and embolism"],
    ["Z86.73", "Personal history of transient ischemic attack (TIA), and cerebral infarction without residual deficits"],
    ["Z87.891", "Personal history of nicotine dependence"],
    ["Z91.14", "Patient's other noncompliance with medication regimen"],
    ["Z95.0", "Presence of cardiac pacemaker"],
    ["Z99.11", "Dependence on renal dialysis"],
  ]),
];

/**
 * Curated Code-First / Use-Additional-Code rules.
 * Keyed by a stable rule id. The validator consumes this list.
 */
export interface CodeFirstRule {
  rule_id: string;
  description_en: string;
  description_ar: string;
  /** If the trigger code appears, this rule fires. */
  trigger_codes: string[];
  /** Codes that should accompany the trigger (suggested). */
  companion_codes: string[];
  /** Codes that should be re-ordered (placed earlier than the trigger). */
  code_first_codes?: string[];
  /** Clinical pattern keywords that activate the rule even without exact code match. */
  pattern_keywords?: string[];
}

export const CODE_FIRST_RULES: CodeFirstRule[] = [
  {
    rule_id: "DIABETES_WITH_FOOT_ULCER",
    description_en: "When diabetes is documented with a foot ulcer, the diabetes-with-foot-ulcer combination code (E11.621 or E13.621) is used FIRST; the ulcer code (L97.-) is added as secondary.",
    description_ar: "عند توثيق السكري مع قرحة القدم، يُستخدم رمز السكري المركب أولاً (E11.621) ثم يُضاف رمز القرحة (L97.-) كثانوي.",
    trigger_codes: ["E11.621", "E13.621", "E10.621"],
    companion_codes: ["L97.4", "L97.9"],
    pattern_keywords: ["diabetic foot", "foot ulcer", "diabetes with ulcer"],
  },
  {
    rule_id: "DIABETES_WITH_NEUROPATHY",
    description_en: "DM2 with diabetic neuropathy should use the combination code E11.40/E11.42 (not E11.9 + separate neuropathy).",
    description_ar: "السكري من النوع الثاني مع اعتلال الأعصاب يجب أن يستخدم الرمز المركب E11.40/E11.42 (وليس E11.9 + رمز مستقل لاعتلال الأعصاب).",
    trigger_codes: ["E11.40", "E11.42", "E10.40"],
    companion_codes: [],
    pattern_keywords: ["diabetic neuropathy", "diabetes with neuropathy"],
  },
  {
    rule_id: "POISONING_EXTERNAL_CAUSE",
    description_en: "For poisoning (T36-T50), code the poisoning FIRST, then add the external cause code (X40-X49, etc.) with 7th character.",
    description_ar: "في حالات التسمم (T36-T50)، يُرمز التسمم أولاً ثم يُضاف رمز السبب الخارجي (X40-X49) مع الحرف السابع.",
    trigger_codes: ["T36", "T37", "T38", "T39", "T40", "T41", "T42", "T43", "T44", "T45", "T46", "T47", "T48", "T49", "T50"],
    companion_codes: [],
    pattern_keywords: ["poisoning", "overdose", "intoxication", "ingested"],
  },
  {
    rule_id: "HTN_WITH_CKD",
    description_en: "Hypertension with chronic kidney disease uses I12.- (hypertensive CKD) PLUS the CKD stage code N18.-, not I10 + N18.- alone.",
    description_ar: "ارتفاع ضغط الدم مع المرض الكلوي المزمن يستخدم I12.- (قصور كلوي بارتفاع ضغط) بالإضافة إلى رمز مرحلة القصور الكلوي N18.-، وليس I10 + N18.- فقط.",
    trigger_codes: ["I12.9", "I12.0"],
    companion_codes: ["N18.9", "N18.6", "N18.4", "N18.3", "N18.32", "N18.31", "N18.2"],
    pattern_keywords: ["hypertensive ckd", "htn with ckd", "hypertension with ckd", "hypertension with chronic kidney"],
  },
  {
    rule_id: "HTN_WITH_CKD_COMBINATION_MISSING",
    description_en: "Hypertension documented with CKD requires the combination code I12.- (or I13.- with heart failure) instead of I10 + N18.-.",
    description_ar: "ارتفاع الضغط مع القصور الكلوي المزمن يتطلب الرمز المركب I12.- (أو I13.- مع فشل القلب) بدلاً من I10 + N18.-.",
    trigger_codes: ["N18"],
    companion_codes: ["I12.9", "I12.0", "I13"],
    pattern_keywords: [],
  },
];
