// Reference data for the demo seed, transcribed exactly from docs/seed-catalogue.md (§5.1–§5.9).
// Pure data plus pure derivations (fit-list expansion, suppliers, auto-pick, demand, bins).
// No Date, Math.random or Intl (SPEC §15). Never imported from src/.
// Prices go through the shared rupee parser (CLAUDE.md rule 3); its formatter is never called here.
import { rupeesToPaise } from "../../src/lib/money";

export type Segment = "motorcycle" | "scooter" | "moped";
export type Brake = "drum" | "disc";
export type StartType = "kick" | "self" | "kick_self";
export type Wheels = "spoke" | "alloy" | "steel";
export type Emission = "bs3" | "bs4" | "bs6" | "bs6_obd2" | "bs6_obd2b";
export type Fuel = "carb" | "fi" | "ei";
export type Category = "consumable" | "wear" | "model_specific";
export type Uom = "pcs" | "set" | "pair" | "bottle" | "kit";
export type WorkshopCode = "NCR" | "JPR";
export type SupplierKey = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";

// ---------------------------------------------------------------------------------------------
// §5.1 Models and mix.

export type PriceClass = "C1" | "C2" | "S" | "M" | "RE";

export type Model = { key: string; make: string; model: string; segment: Segment; mix: number; priceClass: PriceClass };

export const MODELS: readonly Model[] = [
  { key: "SPL", make: "Hero", model: "Splendor Plus", segment: "motorcycle", mix: 18, priceClass: "C1" },
  { key: "ACT", make: "Honda", model: "Activa 110", segment: "scooter", mix: 14, priceClass: "S" },
  { key: "HFD", make: "Hero", model: "HF Deluxe", segment: "motorcycle", mix: 9, priceClass: "C1" },
  { key: "SHN", make: "Honda", model: "Shine 125", segment: "motorcycle", mix: 8, priceClass: "C2" },
  { key: "P150", make: "Bajaj", model: "Pulsar 150", segment: "motorcycle", mix: 7, priceClass: "M" },
  { key: "JUP", make: "TVS", model: "Jupiter", segment: "scooter", mix: 7, priceClass: "S" },
  { key: "ACC", make: "Suzuki", model: "Access 125", segment: "scooter", mix: 5, priceClass: "S" },
  { key: "C350", make: "Royal Enfield", model: "Classic 350", segment: "motorcycle", mix: 5, priceClass: "RE" },
  { key: "PLT", make: "Bajaj", model: "Platina 100", segment: "motorcycle", mix: 4, priceClass: "C1" },
  { key: "APR", make: "TVS", model: "Apache RTR 160 2V", segment: "motorcycle", mix: 4, priceClass: "M" },
  { key: "GLM", make: "Hero", model: "Glamour", segment: "motorcycle", mix: 3, priceClass: "C2" },
  { key: "PSN", make: "Hero", model: "Passion Pro", segment: "motorcycle", mix: 3, priceClass: "C1" },
  { key: "A125", make: "Honda", model: "Activa 125", segment: "scooter", mix: 3, priceClass: "S" },
  { key: "DIO", make: "Honda", model: "Dio", segment: "scooter", mix: 3, priceClass: "S" },
  { key: "FZS", make: "Yamaha", model: "FZ-S", segment: "motorcycle", mix: 3, priceClass: "M" },
  { key: "XL", make: "TVS", model: "XL100", segment: "moped", mix: 3, priceClass: "C1" },
  { key: "NTQ", make: "TVS", model: "Ntorq 125", segment: "scooter", mix: 1, priceClass: "S" },
];

// ---------------------------------------------------------------------------------------------
// §5.2 Variants. Row: key | name | years | F/R | start | wheels | emission | fuel | w.

export type Variant = {
  key: string;
  modelKey: string;
  name: string;
  yearFrom: number;
  yearTo: number | null;
  brakeFront: Brake;
  brakeRear: Brake;
  startType: StartType;
  wheels: Wheels;
  emission: Emission;
  fuel: Fuel;
  weight: number;
};

const VARIANT_ROWS = `
SPL_BS3 | BS3 Self Spoke | 2015–2017 | drum/drum | kick_self | spoke | bs3 | carb | 10
SPL_BS4_K | BS4 Kick Alloy | 2017–2020 | drum/drum | kick | alloy | bs4 | carb | 15
SPL_BS4_S | BS4 Self Alloy | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 20
SPL_BS6_K | BS6 Kick Alloy | 2020–2023 | drum/drum | kick | alloy | bs6 | fi | 15
SPL_BS6_S | BS6 Self Alloy i3S | 2020–2023 | drum/drum | kick_self | alloy | bs6 | fi | 25
SPL_OBD2 | OBD2 Self Alloy (incl. Xtec) | 2023– | drum/drum | kick_self | alloy | bs6_obd2 | fi | 15
HFD_BS4_K | BS4 Kick Spoke | 2017–2020 | drum/drum | kick | spoke | bs4 | carb | 25
HFD_BS4_S | BS4 Self Alloy | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 20
HFD_BS6_K | BS6 Kick Spoke | 2020– | drum/drum | kick | spoke | bs6 | fi | 30
HFD_BS6_S | BS6 Self Alloy | 2020– | drum/drum | kick_self | alloy | bs6 | fi | 25
PSN_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 25
PSN_BS4_DI | BS4 Disc | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 20
PSN_BS6_DR | BS6 Drum | 2020–2023 | drum/drum | kick_self | alloy | bs6 | fi | 30
PSN_BS6_DI | BS6 Disc | 2020–2023 | disc/drum | kick_self | alloy | bs6 | fi | 25
GLM_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 35
GLM_BS6_DR | BS6 Drum | 2020– | drum/drum | kick_self | alloy | bs6 | fi | 35
GLM_BS6_DI | BS6 Disc | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 30
ACT_3G | 3G | 2015–2017 | drum/drum | kick_self | steel | bs3 | carb | 10
ACT_4G | 4G | 2017–2018 | drum/drum | kick_self | steel | bs4 | carb | 15
ACT_5G | 5G (10-inch front) | 2018–2020 | drum/drum | kick_self | steel | bs4 | carb | 25
ACT_6G | 6G (12-inch front, telescopic fork) | 2020–2023 | drum/drum | kick_self | steel | bs6 | fi | 35
ACT_6G_OBD2 | 6G OBD2 | 2023– | drum/drum | kick_self | steel | bs6_obd2 | fi | 15
A125_BS4_DR | BS4 Drum | 2017–2019 | drum/drum | kick_self | steel | bs4 | carb | 25
A125_BS4_DI | BS4 Disc Deluxe | 2017–2019 | disc/drum | kick_self | alloy | bs4 | carb | 15
A125_BS6_DR | BS6 Drum | 2019– | drum/drum | self | steel | bs6 | fi | 35
A125_BS6_DI | BS6 Disc Deluxe | 2019– | disc/drum | self | alloy | bs6 | fi | 25
SHN_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 30
SHN_BS4_DI | BS4 Disc | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 15
SHN_BS6_DR | BS6 Drum | 2020– | drum/drum | self | alloy | bs6 | fi | 35
SHN_BS6_DI | BS6 Disc | 2020– | disc/drum | self | alloy | bs6 | fi | 20
DIO_BS4 | BS4 | 2017–2020 | drum/drum | kick_self | steel | bs4 | carb | 45
DIO_BS6 | BS6 | 2020– | drum/drum | kick_self | steel | bs6 | fi | 55
P150_BS4_SD | BS4 Standard (240mm disc) | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 40
P150_BS4_TD | BS4 Twin Disc (260mm) | 2017–2020 | disc/disc | kick_self | alloy | bs4 | carb | 15
P150_BS6_SD | BS6 Standard (260mm disc) | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 30
P150_BS6_TD | BS6 Twin Disc | 2020– | disc/disc | kick_self | alloy | bs6 | fi | 15
PLT_BS4_K | BS4 KS Spoke | 2017–2020 | drum/drum | kick | spoke | bs4 | carb | 25
PLT_BS4_S | BS4 ES Alloy | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 20
PLT_BS6_K | BS6 KS Alloy | 2020– | drum/drum | kick | alloy | bs6 | ei | 25
PLT_BS6_S | BS6 ES Alloy | 2020– | drum/drum | kick_self | alloy | bs6 | ei | 30
JUP_BS4_BASE | BS4 Base | 2017–2020 | drum/drum | kick_self | steel | bs4 | carb | 20
JUP_BS4_ZX | BS4 ZX | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 15
JUP_BS6_DR | BS6 Drum | 2020–2024 | drum/drum | kick_self | alloy | bs6 | fi | 30
JUP_BS6_DI | BS6 ZX Disc | 2020–2024 | disc/drum | kick_self | alloy | bs6 | fi | 20
JUP_NG | New generation 113cc | 2024– | drum/drum | kick_self | alloy | bs6_obd2 | fi | 15
APR_BS4_RD | BS4 Rear Drum | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 30
APR_BS4_TD | BS4 Rear Disc | 2017–2020 | disc/disc | kick_self | alloy | bs4 | carb | 20
APR_BS6_RD | BS6 Rear Drum | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 30
APR_BS6_TD | BS6 Twin Disc | 2020– | disc/disc | kick_self | alloy | bs6 | fi | 20
XL_BS4_K | BS4 Heavy Duty (kick) | 2017–2020 | drum/drum | kick | spoke | bs4 | carb | 30
XL_BS4_S | BS4 i-Touchstart | 2017–2020 | drum/drum | kick_self | spoke | bs4 | carb | 20
XL_BS6_K | BS6 Heavy Duty (kick) | 2020– | drum/drum | kick | spoke | bs6 | fi | 25
XL_BS6_S | BS6 i-Touchstart | 2020– | drum/drum | kick_self | spoke | bs6 | fi | 25
NTQ_BS4 | BS4 Disc | 2018–2020 | disc/drum | kick_self | alloy | bs4 | carb | 35
NTQ_BS6 | BS6 Disc | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 65
ACC_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | steel | bs4 | carb | 25
ACC_BS4_DI | BS4 Disc | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 15
ACC_BS6_DR | BS6 Drum | 2020–2025 | drum/drum | kick_self | alloy | bs6 | fi | 35
ACC_BS6_DI | BS6 Disc | 2020–2025 | disc/drum | kick_self | alloy | bs6 | fi | 25
FZS_V2 | V2.0 FI | 2017–2019 | disc/drum | self | alloy | bs4 | fi | 35
FZS_V3_BS4 | V3.0 BS4 (ABS) | 2019–2020 | disc/disc | self | alloy | bs4 | fi | 20
FZS_V3_BS6 | V3.0 BS6 (ABS) | 2020– | disc/disc | self | alloy | bs6 | fi | 45
C350_UCE_BS4 | UCE BS4 (carb) | 2017–2020 | disc/drum | kick_self | spoke | bs4 | carb | 35
C350_UCE_BS6 | UCE BS6 (EFI) | 2020–2021 | disc/drum | kick_self | spoke | bs6 | fi | 15
C350_J_RED | J-series Redditch (single-channel ABS) | 2021–2024 | disc/drum | self | spoke | bs6 | fi | 25
C350_J_SIG | J-series Signals (dual-channel ABS) | 2021–2024 | disc/disc | self | spoke | bs6 | fi | 25
`;

function cells(row: string): string[] {
  return row.split("|").map((c) => c.trim());
}

function rows(block: string): string[][] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(cells);
}

export const VARIANTS: readonly Variant[] = rows(VARIANT_ROWS).map(([key, name, years, brakes, start, wheels, emission, fuel, w]) => {
  const [from, to] = years.split("–");
  const [bf, br] = brakes.split("/");
  const model = MODELS.find((m) => key.startsWith(m.key + "_"));
  if (!model) throw new Error(`variant ${key}: no model`);
  return {
    key,
    modelKey: model.key,
    name,
    yearFrom: Number(from),
    yearTo: to ? Number(to) : null,
    brakeFront: bf as Brake,
    brakeRear: br as Brake,
    startType: start as StartType,
    wheels: wheels as Wheels,
    emission: emission as Emission,
    fuel: fuel as Fuel,
    weight: Number(w),
  };
});

export const MODEL_BY_KEY = new Map(MODELS.map((m) => [m.key, m]));
export const VARIANT_BY_KEY = new Map(VARIANTS.map((v) => [v.key, v]));

/** The last mfg_year the generator draws (§5.2: min(year_to or 2025, 2025)). */
export const LAST_MFG_YEAR = 2025;

// ---------------------------------------------------------------------------------------------
// §5.3 Suppliers.

export type Supplier = {
  key: SupplierKey;
  name: string;
  city: string;
  kind: "oem_dealer" | "wholesaler" | "local_market";
  leadTimeDays: number;
  phone: string;
};

export const SUPPLIERS: readonly Supplier[] = [
  { key: "S1", name: "NCR OEM Parts Distributor", city: "Delhi", kind: "oem_dealer", leadTimeDays: 3, phone: "+91 90000 00001" },
  { key: "S2", name: "Kashmere Gate Wholesale Spares", city: "Delhi", kind: "wholesaler", leadTimeDays: 1, phone: "+91 90000 00002" },
  { key: "S3", name: "Karol Bagh Spares Counter", city: "Delhi", kind: "local_market", leadTimeDays: 0, phone: "+91 90000 00003" },
  { key: "S4", name: "RE Authorised Parts Distributor", city: "Delhi", kind: "oem_dealer", leadTimeDays: 5, phone: "+91 90000 00004" },
  { key: "S5", name: "Honda Authorised Dealer Parts Desk", city: "Delhi", kind: "oem_dealer", leadTimeDays: 7, phone: "+91 90000 00005" },
  { key: "S6", name: "Jaipur Spares Wholesale", city: "Jaipur", kind: "wholesaler", leadTimeDays: 2, phone: "+91 90000 00006" },
  { key: "S7", name: "Jaipur OEM Parts Distributor", city: "Jaipur", kind: "oem_dealer", leadTimeDays: 4, phone: "+91 90000 00007" },
  { key: "S8", name: "Jaipur Local Spares Shop", city: "Jaipur", kind: "local_market", leadTimeDays: 0, phone: "+91 90000 00008" },
];

export const SUPPLIER_BY_KEY = new Map(SUPPLIERS.map((s) => [s.key, s]));

// ---------------------------------------------------------------------------------------------
// §5.4 Parts with explicit fitments. Row: SKU | name | part_type | uom | ₹ (", alt ₹X") | fits | extras.
// extras: oem=<no>; s2code=<code> (supplier_code at S2); amS2code=<code> (on the -AM SKU at S2).

const CONSUMABLE_ROWS = `
OIL-20W40-1L | Engine oil 20W40 JASO MA 1L | engine_oil | bottle | 380 | SPL_*, HFD_*, PSN_*, GLM_*, SHN_*, P150_*, PLT_*, APR_*, FZS_*, XL_* |
OIL-10W30-SC-08L | Scooter engine oil 10W30 JASO MB 0.8L | engine_oil | bottle | 330 | ACT_*, A125_*, DIO_*, JUP_*, NTQ_*, ACC_* |
OIL-15W50-RE-1L | Engine oil 15W50 1L (Royal Enfield) | engine_oil | bottle | 650 | C350_UCE* ×3, C350_J* ×2 |
GOIL-SC-120ML | Scooter gear oil 120ml | gear_oil | bottle | 110 | ACT_*, A125_*, DIO_*, JUP_*, NTQ_*, ACC_* |
BFL-DOT3-100ML | Brake fluid DOT3 100ml | brake_fluid | bottle | 90 | universal |
BLB-HL-3535 | Headlamp bulb 12V 35/35W | headlamp_bulb | pcs | 90 | universal |
BLB-HL-H4-RE | Headlamp bulb H4 12V 60/55W | headlamp_bulb | pcs | 280 | C350_* |
IND-UNIV-PAIR | Turn indicator assembly 12V (pair) | turn_indicator | pair | 280 | universal |
SP-HERO-100 | Spark plug Hero 100-113cc | spark_plug | pcs | 120 | SPL_*, HFD_*, PSN_* |
SP-HERO-125 | Spark plug Hero Glamour 125 | spark_plug | pcs | 130 | GLM_* |
SP-HON-SC | Spark plug Honda scooter | spark_plug | pcs | 140 | ACT_*, A125_*, DIO_* |
SP-HON-SHN | Spark plug Honda Shine 125 | spark_plug | pcs | 140 | SHN_* |
SP-BAJ-150 | Spark plug Pulsar 150 DTS-i | spark_plug | pcs | 150 | P150_* ×2 |
SP-BAJ-100 | Spark plug Platina 100 | spark_plug | pcs | 110 | PLT_* |
SP-TVS-110 | Spark plug TVS 100-125cc | spark_plug | pcs | 130 | JUP_*, NTQ_*, XL_* |
SP-TVS-160 | Spark plug Apache RTR 160 | spark_plug | pcs | 160 | APR_* |
SP-SUZ-125 | Spark plug Suzuki Access 125 | spark_plug | pcs | 140 | ACC_* |
SP-YAM-FZ | Spark plug Yamaha FZ-S | spark_plug | pcs | 170 | FZS_* |
SP-RE-350 | Spark plug Royal Enfield 350 | spark_plug | pcs | 180 | C350_* |
AF-HERO-CARB | Air filter Hero 100cc carb | air_filter | pcs | 170 | SPL_BS3, SPL_BS4*, HFD_BS4*, PSN_BS4* |
AF-HERO-BS6 | Air filter Hero BS6 (17208AABA00S) | air_filter | pcs | 155 | SPL_BS6*, SPL_OBD2, HFD_BS6*, PSN_BS6*, GLM_BS6* | oem=17208AABA00S
AF-GLM-BS4 | Air filter Glamour BS4 | air_filter | pcs | 210 | GLM_BS4_DR |
AF-ACT-CARB | Air filter Activa 3G-5G / Dio BS4 | air_filter | pcs | 220 | ACT_3G, ACT_4G, ACT_5G, DIO_BS4 |
AF-ACT-6G | Air filter Activa 6G / Dio BS6 | air_filter | pcs | 240 | ACT_6G*, DIO_BS6 |
AF-A125 | Air filter Activa 125 | air_filter | pcs | 250 | A125_* |
AF-SHN-BS4 | Air filter Shine 125 BS4 | air_filter | pcs | 230 | SHN_BS4* |
AF-SHN-BS6 | Air filter Shine 125 BS6 | air_filter | pcs | 240 | SHN_BS6* |
AF-P150 | Air filter Pulsar 150 | air_filter | pcs | 260 | P150_* |
AF-PLT | Air filter Platina 100 | air_filter | pcs | 180 | PLT_* |
AF-JUP | Air filter Jupiter BS4 | air_filter | pcs | 230 | JUP_BS4* |
AF-JUP-BS6 | Air filter Jupiter BS6 | air_filter | pcs | 240 | JUP_BS6* |
AF-JUP-NG | Air filter Jupiter 113 | air_filter | pcs | 260 | JUP_NG |
AF-APR | Air filter Apache RTR 160 | air_filter | pcs | 300 | APR_* |
AF-XL | Air filter XL100 | air_filter | pcs | 150 | XL_* |
AF-NTQ | Air filter Ntorq 125 | air_filter | pcs | 280 | NTQ_* |
AF-ACC | Air filter Access 125 | air_filter | pcs | 240 | ACC_* |
AF-FZ | Air filter FZ-S | air_filter | pcs | 350 | FZS_* |
AF-RE-UCE | Air filter Classic 350 UCE | air_filter | pcs | 550 | C350_UCE* |
AF-RE-J | Air filter Classic 350 J | air_filter | pcs | 650 | C350_J* |
OF-P150 | Oil filter Pulsar 150 | oil_filter | pcs | 140 | P150_* |
OF-APR | Oil filter Apache RTR 160 | oil_filter | pcs | 160 | APR_* |
OF-FZ | Oil filter FZ-S | oil_filter | pcs | 180 | FZS_* |
OF-RE-UCE | Oil filter Classic 350 UCE | oil_filter | pcs | 220 | C350_UCE* |
OF-RE-J | Oil filter Classic 350 J | oil_filter | pcs | 250 | C350_J* |
`;

const WEAR_ROWS = `
FBS-HERO-130 | Front brake shoe set Hero 130mm | front_brake_shoe | set | 220, alt 150 | SPL_*, HFD_*, PSN_BS4_DR, PSN_BS6_DR, GLM_BS4_DR, GLM_BS6_DR |
FBS-HON-SC | Front brake shoe set Honda scooter 130mm | front_brake_shoe | set | 260 | ACT_*, A125_BS4_DR, A125_BS6_DR, DIO_* |
FBS-SHN | Front brake shoe set Shine 125 | front_brake_shoe | set | 250 | SHN_BS4_DR, SHN_BS6_DR |
FBS-PLT | Front brake shoe set Platina 100 | front_brake_shoe | set | 210 | PLT_* |
FBS-TVS-SC | Front brake shoe set Jupiter | front_brake_shoe | set | 240 | JUP_BS4*, JUP_BS6_DR, JUP_NG |
FBS-XL | Front brake shoe set XL100 | front_brake_shoe | set | 180 | XL_* |
FBS-ACC | Front brake shoe set Access 125 | front_brake_shoe | set | 250 | ACC_BS4_DR, ACC_BS6_DR |
RBS-HERO-130 | Rear brake shoe set Hero 130mm | rear_brake_shoe | set | 220, alt 150 | SPL_*, HFD_*, PSN_*, GLM_* |
RBS-HON-SC | Rear brake shoe set Honda scooter 130mm | rear_brake_shoe | set | 260 | ACT_*, A125_*, DIO_* |
RBS-SHN | Rear brake shoe set Shine 125 | rear_brake_shoe | set | 250 | SHN_* |
RBS-P150 | Rear brake shoe set Pulsar 150 | rear_brake_shoe | set | 280 | P150_BS4_SD, P150_BS6_SD |
RBS-PLT | Rear brake shoe set Platina 100 | rear_brake_shoe | set | 210 | PLT_* |
RBS-TVS-SC | Rear brake shoe set Jupiter / Ntorq | rear_brake_shoe | set | 240 | JUP_*, NTQ_* |
RBS-APR | Rear brake shoe set Apache RTR 160 | rear_brake_shoe | set | 280 | APR_BS4_RD, APR_BS6_RD |
RBS-XL | Rear brake shoe set XL100 | rear_brake_shoe | set | 180 | XL_* |
RBS-ACC | Rear brake shoe set Access 125 | rear_brake_shoe | set | 250 | ACC_* |
RBS-FZ | Rear brake shoe set FZ-S V2 | rear_brake_shoe | set | 300 | FZS_V2 |
RBS-RE-153 | Rear brake shoe set Royal Enfield 153mm | rear_brake_shoe | set | 450 | C350_UCE*, C350_J_RED |
FBP-HERO | Front brake pads Hero disc | front_brake_pad | set | 320 | PSN_BS4_DI, PSN_BS6_DI, GLM_BS6_DI |
FBP-HON | Front brake pads Honda disc | front_brake_pad | set | 350 | A125_BS4_DI, A125_BS6_DI, SHN_BS4_DI, SHN_BS6_DI |
FBP-P150-240 | Front brake pads Pulsar 150 (240mm) | front_brake_pad | set | 380 | P150_BS4_SD |
FBP-P150-260 | Front brake pads Pulsar 150 (260mm) | front_brake_pad | set | 420 | P150_BS4_TD, P150_BS6* |
FBP-TVS-SC | Front brake pads Jupiter / Ntorq | front_brake_pad | set | 340 | JUP_BS6_DI, NTQ_* |
FBP-APR | Front brake pads Apache RTR 160 | front_brake_pad | set | 450 | APR_* |
FBP-ACC | Front brake pads Access 125 | front_brake_pad | set | 350 | ACC_BS4_DI, ACC_BS6_DI |
FBP-FZ | Front brake pads FZ-S | front_brake_pad | set | 480 | FZS_* |
FBP-RE-UCE | Front brake pads Classic 350 UCE (280mm) | front_brake_pad | set | 650 | C350_UCE* |
FBP-RE-J | Front brake pads Classic 350 J (300mm) | front_brake_pad | set | 750 | C350_J* |
RBP-P150 | Rear brake pads Pulsar 150 Twin Disc | rear_brake_pad | set | 400 | P150_BS4_TD, P150_BS6_TD |
RBP-APR | Rear brake pads Apache RTR 160 | rear_brake_pad | set | 420 | APR_BS4_TD, APR_BS6_TD |
RBP-FZ | Rear brake pads FZ-S V3 | rear_brake_pad | set | 450 | FZS_V3* |
RBP-RE-J | Rear brake pads Classic 350 J (270mm) | rear_brake_pad | set | 700 | C350_J_SIG |
CSK-SPL | Chain sprocket kit Splendor Plus 428-106L 14/43T | chain_sprocket_kit | kit | 913, alt 600 | SPL_* | s2code=CH-5004
CSK-HFD | Chain sprocket kit HF Deluxe | chain_sprocket_kit | kit | 850 | HFD_* |
CSK-PSN | Chain sprocket kit Passion Pro 420-108L 14/44T | chain_sprocket_kit | kit | 880 | PSN_* | s2code=CH-5003
CSK-GLM | Chain sprocket kit Glamour | chain_sprocket_kit | kit | 1050 | GLM_* |
CSK-SHN | Chain sprocket kit Shine 125 | chain_sprocket_kit | kit | 1100 | SHN_* |
CSK-P150 | Chain sprocket kit Pulsar 150 | chain_sprocket_kit | kit | 1450 | P150_* |
CSK-PLT | Chain sprocket kit Platina 100 | chain_sprocket_kit | kit | 850 | PLT_* |
CSK-APR | Chain sprocket kit Apache RTR 160 | chain_sprocket_kit | kit | 1550 | APR_* |
CSK-FZ | Chain sprocket kit FZ-S | chain_sprocket_kit | kit | 1650 | FZS_* |
CSK-XL | Chain sprocket kit XL100 | chain_sprocket_kit | kit | 750 | XL_* |
CSK-RE-UCE | Chain sprocket kit Classic 350 UCE | chain_sprocket_kit | kit | 2400 | C350_UCE* |
CSK-RE-J | Chain sprocket kit Classic 350 J | chain_sprocket_kit | kit | 3200 | C350_J* |
CPL-HERO-97 | Clutch plate set Hero 97cc engine | clutch_plate_set | set | 420, alt 190 | SPL_*, HFD_* | amS2code=2CP-1106
CPL-PSN | Clutch plate set Passion Pro | clutch_plate_set | set | 480 | PSN_* |
CPL-GLM | Clutch plate set Glamour | clutch_plate_set | set | 520 | GLM_* |
CPL-SHN | Clutch plate set Shine 125 | clutch_plate_set | set | 550 | SHN_* |
CPL-P150 | Clutch plate set Pulsar 150 | clutch_plate_set | set | 650 | P150_* |
CPL-PLT | Clutch plate set Platina 100 | clutch_plate_set | set | 450 | PLT_* |
CPL-APR | Clutch plate set Apache RTR 160 | clutch_plate_set | set | 700 | APR_* |
CPL-FZ | Clutch plate set FZ-S | clutch_plate_set | set | 750 | FZS_* |
CPL-RE-UCE | Clutch plate set Classic 350 UCE | clutch_plate_set | set | 1600 | C350_UCE* |
CPL-RE-J | Clutch plate set Classic 350 J | clutch_plate_set | set | 1900 | C350_J* |
DBT-ACT110 | Drive belt Activa 110 / Dio | drive_belt | pcs | 850 | ACT_*, DIO_* |
DBT-A125 | Drive belt Activa 125 | drive_belt | pcs | 950 | A125_* |
DBT-JUP | Drive belt Jupiter BS4/BS6 | drive_belt | pcs | 900 | JUP_BS4*, JUP_BS6* |
DBT-JUP-NG | Drive belt Jupiter 113 | drive_belt | pcs | 950 | JUP_NG |
DBT-NTQ | Drive belt Ntorq 125 | drive_belt | pcs | 1050 | NTQ_* |
DBT-ACC | Drive belt Access 125 | drive_belt | pcs | 950 | ACC_* |
CCB-SPL | Clutch cable Splendor Plus | clutch_cable | pcs | 135 | SPL_* |
CCB-HFD | Clutch cable HF Deluxe | clutch_cable | pcs | 130 | HFD_* |
CCB-PSN | Clutch cable Passion Pro | clutch_cable | pcs | 150 | PSN_* |
CCB-GLM | Clutch cable Glamour | clutch_cable | pcs | 160 | GLM_* |
CCB-SHN | Clutch cable Shine 125 | clutch_cable | pcs | 170 | SHN_* |
CCB-P150 | Clutch cable Pulsar 150 | clutch_cable | pcs | 190 | P150_* |
CCB-PLT | Clutch cable Platina 100 | clutch_cable | pcs | 140 | PLT_* |
CCB-APR | Clutch cable Apache RTR 160 | clutch_cable | pcs | 210 | APR_* |
CCB-FZ | Clutch cable FZ-S | clutch_cable | pcs | 220 | FZS_* |
CCB-RE-UCE | Clutch cable Classic 350 UCE | clutch_cable | pcs | 260 | C350_UCE* |
CCB-RE-J | Clutch cable Classic 350 J | clutch_cable | pcs | 280 | C350_J* |
BAT-12V-25AH | Battery 12V 2.5Ah (kick start) | battery | pcs | 1100 | SPL_BS4_K, SPL_BS6_K, HFD_BS4_K, HFD_BS6_K, PLT_BS4_K, PLT_BS6_K, XL_BS4_K, XL_BS6_K | s2code=12XL2.5L-C
BAT-12V-4AH | Battery 12V 4Ah (self start) | battery | pcs | 1600 | SPL_BS3, SPL_BS4_S, SPL_BS6_S, SPL_OBD2, HFD_BS4_S, HFD_BS6_S, PSN_*, GLM_*, SHN_*, PLT_BS4_S, PLT_BS6_S, XL_BS4_S, XL_BS6_S, ACT_*, A125_*, DIO_*, JUP_*, ACC_* |
BAT-12V-5AH | Battery 12V 5Ah | battery | pcs | 1900 | P150_*, APR_*, FZS_*, NTQ_* |
BAT-RE-350 | Battery 12V Royal Enfield 350 | battery | pcs | 3400 | C350_* |
RSH-HERO | Rear shock absorber pair Hero commuter | rear_shock | pair | 1600 | SPL_*, HFD_*, PSN_*, GLM_* |
RSH-HON-SC | Rear shock absorber Honda scooter | rear_shock | pcs | 1800 | ACT_*, A125_*, DIO_* |
RSH-SHN | Rear shock absorber pair Shine 125 | rear_shock | pair | 1900 | SHN_* |
RSH-P150 | Rear shock absorber pair Pulsar 150 | rear_shock | pair | 2400 | P150_* |
RSH-PLT | Rear shock absorber pair Platina 100 | rear_shock | pair | 1500 | PLT_* |
RSH-TVS-SC | Rear shock absorber Jupiter / Ntorq | rear_shock | pcs | 1700 | JUP_*, NTQ_* |
RSH-APR | Rear shock absorber pair Apache RTR 160 2V | rear_shock | pair | 2600 | APR_* |
RSH-XL | Rear shock absorber pair XL100 | rear_shock | pair | 1300 | XL_* |
RSH-ACC | Rear shock absorber Access 125 | rear_shock | pcs | 1800 | ACC_* |
RSH-FZ | Rear monoshock FZ-S | rear_shock | pcs | 3000 | FZS_* |
RSH-RE | Rear shock absorber pair Classic 350 | rear_shock | pair | 3500 | C350_* |
FSK-HERO | Front fork seal kit Hero commuter | fork_seal_kit | kit | 250 | SPL_*, HFD_*, PSN_*, GLM_* |
FSK-HON-SC | Front fork seal kit Honda scooter (telescopic) | fork_seal_kit | kit | 320 | ACT_6G*, A125_*, DIO_* |
FSK-SHN | Front fork seal kit Shine 125 | fork_seal_kit | kit | 300 | SHN_* |
FSK-P150 | Front fork seal kit Pulsar 150 | fork_seal_kit | kit | 350 | P150_* |
FSK-PLT | Front fork seal kit Platina 100 | fork_seal_kit | kit | 260 | PLT_* |
FSK-TVS | Front fork seal kit Jupiter / Ntorq | fork_seal_kit | kit | 300 | JUP_*, NTQ_* |
FSK-XL | Front fork seal kit XL100 | fork_seal_kit | kit | 220 | XL_* |
FSK-APR | Front fork seal kit Apache RTR 160 | fork_seal_kit | kit | 380 | APR_* |
FSK-ACC | Front fork seal kit Access 125 | fork_seal_kit | kit | 320 | ACC_* |
FSK-FZ | Front fork seal kit FZ-S | fork_seal_kit | kit | 420 | FZS_* |
FSK-RE-UCE | Front fork seal kit Classic 350 UCE (35mm) | fork_seal_kit | kit | 420 | C350_UCE* |
FSK-RE-J | Front fork seal kit Classic 350 J (41mm) | fork_seal_kit | kit | 480 | C350_J* |
MIR-HERO-100 | Mirror set Hero 100cc (pair) | mirror_set | pair | 350 | SPL_*, HFD_* | oem=88110AAEH31S
MIR-HERO-125 | Mirror set Passion / Glamour (pair) | mirror_set | pair | 380 | PSN_*, GLM_* |
MIR-HON | Mirror set Honda (pair) | mirror_set | pair | 400 | ACT_*, A125_*, DIO_*, SHN_* |
MIR-BAJ | Mirror set Bajaj (pair) | mirror_set | pair | 380 | P150_*, PLT_* |
MIR-TVS | Mirror set TVS scooter / XL (pair) | mirror_set | pair | 360 | JUP_*, NTQ_*, XL_* |
MIR-APR | Mirror set Apache RTR 160 (pair) | mirror_set | pair | 450 | APR_* |
MIR-SUZ | Mirror set Suzuki Access (pair) | mirror_set | pair | 420 | ACC_* |
MIR-YAM | Mirror set Yamaha FZ-S (pair) | mirror_set | pair | 480 | FZS_* |
MIR-RE | Mirror set Royal Enfield Classic (pair) | mirror_set | pair | 650 | C350_* |
RT-275-18-TT | Rear tyre 2.75-18 tube-type with tube | rear_tyre | set | 1650 | SPL_BS3, HFD_BS4_K, HFD_BS6_K |
RT-275-18-TL | Rear tyre 2.75-18 tubeless | rear_tyre | pcs | 1550 | SPL_BS4*, SPL_BS6*, SPL_OBD2, HFD_BS4_S, HFD_BS6_S |
RT-80100-18-TL | Rear tyre 80/100-18 tubeless | rear_tyre | pcs | 1700 | PSN_*, GLM_*, SHN_* |
RT-300-17-TT | Rear tyre 3.00-17 tube-type with tube | rear_tyre | set | 1600 | PLT_BS4_K |
RT-300-17-TL | Rear tyre 3.00-17 tubeless | rear_tyre | pcs | 1550 | PLT_BS4_S, PLT_BS6* |
RT-12080-17-TL | Rear tyre 120/80-17 tubeless | rear_tyre | pcs | 2600 | P150_* |
RT-11080-17-TL | Rear tyre 110/80-17 tubeless | rear_tyre | pcs | 2400 | APR_* |
RT-14060-17-TL | Rear tyre 140/60-17 tubeless | rear_tyre | pcs | 3400 | FZS_* |
RT-12080-18-TT | Rear tyre 120/80-18 tube-type with tube | rear_tyre | set | 3600 | C350_* |
RT-90100-10-TL | Rear tyre 90/100-10 tubeless | rear_tyre | pcs | 1450 | ACT_*, A125_*, DIO_*, ACC_* |
RT-9090-12-TL | Rear tyre 90/90-12 tubeless | rear_tyre | pcs | 1600 | JUP_* |
RT-11080-12-TL | Rear tyre 110/80-12 tubeless | rear_tyre | pcs | 1900 | NTQ_* |
RT-250-16-TT | Rear tyre 2.50-16 tube-type with tube | rear_tyre | set | 1250 | XL_* |
FT-275-18-TT | Front tyre 2.75-18 tube-type with tube | front_tyre | set | 1550 | SPL_BS3, HFD_BS4_K, HFD_BS6_K |
FT-275-18-TL | Front tyre 2.75-18 tubeless | front_tyre | pcs | 1450 | SPL_BS4*, SPL_BS6*, SPL_OBD2, HFD_BS4_S, HFD_BS6_S |
FT-80100-18-TL | Front tyre 80/100-18 tubeless | front_tyre | pcs | 1600 | PSN_*, GLM_*, SHN_* |
FT-275-17-TT | Front tyre 2.75-17 tube-type with tube | front_tyre | set | 1450 | PLT_BS4_K |
FT-275-17-TL | Front tyre 2.75-17 tubeless | front_tyre | pcs | 1400 | PLT_BS4_S, PLT_BS6* |
FT-9090-17-TL | Front tyre 90/90-17 tubeless | front_tyre | pcs | 1800 | P150_*, APR_* |
FT-10080-17-TL | Front tyre 100/80-17 tubeless | front_tyre | pcs | 2100 | FZS_* |
FT-9090-19-TT | Front tyre 90/90-19 tube-type with tube | front_tyre | set | 3000 | C350_* |
FT-90100-10-TL | Front tyre 90/100-10 tubeless | front_tyre | pcs | 1400 | ACT_3G, ACT_4G, ACT_5G, DIO_* |
FT-9090-12-TL | Front tyre 90/90-12 tubeless | front_tyre | pcs | 1550 | ACT_6G*, A125_*, JUP_*, ACC_* |
FT-10080-12-TL | Front tyre 100/80-12 tubeless | front_tyre | pcs | 1800 | NTQ_* |
FT-250-16-TT | Front tyre 2.50-16 tube-type with tube | front_tyre | set | 1200 | XL_* |
`;

export type Fit = { variantKey: string; qty: number };

export type Part = {
  sku: string;
  name: string;
  nameHi: string;
  aliases: string[];
  oemPartNo: string | null;
  category: Category;
  partType: string;
  uom: Uom;
  pricePaise: number;
  isUniversal: boolean;
  isAftermarket: boolean;
  fits: Fit[];
  /** supplier_code at S2, where §5.4 names a brand part number. */
  s2Code: string | null;
};

/** Expands a fits list: `SPL_*` / `SPL_BS6*` = prefix, otherwise exact key; `×N` = qty_per_bike. */
export function expandFits(spec: string): Fit[] {
  const out: Fit[] = [];
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\S+?)(?:\s*×(\d+))?$/.exec(raw);
    if (!m) throw new Error(`bad fit token ${raw}`);
    const [, pattern, n] = m;
    const qty = n ? Number(n) : 1;
    const hits = pattern.endsWith("*")
      ? VARIANTS.filter((v) => v.key.startsWith(pattern.slice(0, -1)))
      : VARIANTS.filter((v) => v.key === pattern);
    if (hits.length === 0) throw new Error(`fit pattern ${pattern} matches no variant`);
    for (const v of hits) {
      if (out.some((f) => f.variantKey === v.key)) throw new Error(`variant ${v.key} listed twice`);
      out.push({ variantKey: v.key, qty });
    }
  }
  return out;
}

// §5.6 Hindi prefixes and aliases by part_type, plus the English lead words each name starts with.
const HINDI: Record<string, { prefix: string; aliases: string[]; lead: string[] }> = {
  engine_oil: { prefix: "इंजन ऑयल", aliases: ["mobil", "oil", "engine oil"], lead: ["Scooter engine oil", "Engine oil"] },
  gear_oil: { prefix: "गियर ऑयल", aliases: ["gear oil"], lead: ["Scooter gear oil"] },
  brake_fluid: { prefix: "ब्रेक ऑयल", aliases: ["brake oil"], lead: ["Brake fluid"] },
  headlamp_bulb: { prefix: "हेडलाइट बल्ब", aliases: ["bulb", "light bulb"], lead: ["Headlamp bulb"] },
  turn_indicator: { prefix: "इंडिकेटर", aliases: ["indicator", "winker"], lead: ["Turn indicator assembly"] },
  spark_plug: { prefix: "स्पार्क प्लग", aliases: ["plug", "spark"], lead: ["Spark plug"] },
  air_filter: { prefix: "एयर फ़िल्टर", aliases: ["air filter", "filter"], lead: ["Air filter"] },
  oil_filter: { prefix: "ऑयल फ़िल्टर", aliases: ["oil filter"], lead: ["Oil filter"] },
  front_brake_shoe: { prefix: "ब्रेक शू", aliases: ["break shoe", "brake shoe", "shoe"], lead: ["Front brake shoe set"] },
  rear_brake_shoe: { prefix: "ब्रेक शू", aliases: ["break shoe", "brake shoe", "shoe"], lead: ["Rear brake shoe set"] },
  front_brake_pad: { prefix: "ब्रेक पैड", aliases: ["break pad", "disc pad"], lead: ["Front brake pads"] },
  rear_brake_pad: { prefix: "ब्रेक पैड", aliases: ["break pad", "disc pad"], lead: ["Rear brake pads"] },
  chain_sprocket_kit: { prefix: "चेन सॉकेट किट", aliases: ["chain set", "chain kit", "socket"], lead: ["Chain sprocket kit"] },
  clutch_plate_set: { prefix: "क्लच प्लेट", aliases: ["clutch plate"], lead: ["Clutch plate set"] },
  drive_belt: { prefix: "बेल्ट", aliases: ["belt", "v belt"], lead: ["Drive belt"] },
  clutch_cable: { prefix: "क्लच वायर", aliases: ["clutch wire"], lead: ["Clutch cable"] },
  accelerator_cable: { prefix: "एक्सीलेटर वायर", aliases: ["race wire", "accelerator wire"], lead: ["Accelerator cable"] },
  carb_repair_kit: { prefix: "कार्बोरेटर किट", aliases: ["carb kit", "carburettor"], lead: ["Carburettor repair kit"] },
  battery: { prefix: "बैटरी", aliases: ["battery"], lead: ["Battery"] },
  rear_shock: { prefix: "शॉकर", aliases: ["shocker", "shock"], lead: ["Rear shock absorber pair", "Rear shock absorber", "Rear monoshock"] },
  fork_seal_kit: { prefix: "फोर्क सील", aliases: ["fork seal", "oil seal"], lead: ["Front fork seal kit"] },
  mirror_set: { prefix: "शीशा", aliases: ["mirror", "sheesha"], lead: ["Mirror set"] },
  rear_tyre: { prefix: "टायर", aliases: ["tyre", "tire", "tayar"], lead: ["Rear tyre"] },
  front_tyre: { prefix: "टायर", aliases: ["tyre", "tire", "tayar"], lead: ["Front tyre"] },
  headlamp_assembly: { prefix: "हेडलाइट", aliases: ["headlight"], lead: ["Headlamp assembly"] },
  tail_lamp_assembly: { prefix: "टेल लाइट", aliases: ["back light", "tail light"], lead: ["Tail lamp assembly"] },
  side_panel_set: { prefix: "साइड पैनल", aliases: ["side cover", "panel"], lead: ["Side panel set"] },
  front_mudguard: { prefix: "मडगार्ड", aliases: ["mudguard", "front fender"], lead: ["Front mudguard"] },
  seat_cover: { prefix: "सीट कवर", aliases: ["seat cover"], lead: ["Seat cover"] },
  speedometer: { prefix: "स्पीडोमीटर", aliases: ["meter", "speedo"], lead: ["Speedometer"] },
};

/** name_hi = the Hindi prefix plus the rest of the English name (model names stay Latin). */
function hindiName(partType: string, name: string): string {
  const h = HINDI[partType];
  if (!h) throw new Error(`no Hindi entry for ${partType}`);
  const lead = h.lead.find((l) => name.startsWith(l));
  const rest = lead ? name.slice(lead.length).trim() : name;
  const side = partType.startsWith("front_") ? "आगे का " : partType.startsWith("rear_") ? "पीछे का " : "";
  return `${side}${h.prefix}${rest ? " " + rest : ""}`;
}

function makePart(p: Omit<Part, "nameHi" | "aliases">): Part {
  return { ...p, nameHi: hindiName(p.partType, p.name), aliases: [...HINDI[p.partType].aliases] };
}

function catalogPaise(sku: string, rupees: string): number {
  const paise = rupeesToPaise(rupees);
  if (paise === null) throw new Error(`Bad price ${JSON.stringify(rupees)} for ${sku}`);
  return paise;
}

function explicitParts(block: string, category: Category): Part[] {
  const out: Part[] = [];
  for (const [sku, name, partType, uom, price, fits, extras = ""] of rows(block)) {
    const [base, alt] = price.split(",").map((s) => s.trim());
    const extra = new Map(
      extras
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean)
        .map((e) => e.split("=") as [string, string]),
    );
    const universal = fits === "universal";
    const fitList = universal ? [] : expandFits(fits);
    out.push(
      makePart({
        sku,
        name,
        oemPartNo: extra.get("oem") ?? null,
        category,
        partType,
        uom: uom as Uom,
        pricePaise: catalogPaise(sku, base),
        isUniversal: universal,
        isAftermarket: false,
        fits: fitList,
        s2Code: extra.get("s2code") ?? null,
      }),
    );
    if (alt) {
      out.push(
        makePart({
          sku: `${sku}-AM`,
          name: `${name} (aftermarket)`,
          oemPartNo: null,
          category,
          partType,
          uom: uom as Uom,
          pricePaise: catalogPaise(`${sku}-AM`, alt.replace("alt", "").trim()),
          isUniversal: false,
          isAftermarket: true,
          fits: fitList.map((f) => ({ ...f })),
          s2Code: extra.get("amS2code") ?? null,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// §5.5 Parts generated by rule.

const RULE_PRICES: Record<string, Record<PriceClass, number>> = {
  accelerator_cable: { C1: 120, C2: 140, S: 160, M: 170, RE: 240 },
  carb_repair_kit: { C1: 250, C2: 290, S: 310, M: 360, RE: 650 },
  headlamp_assembly: { C1: 650, C2: 800, S: 950, M: 1400, RE: 2400 },
  tail_lamp_assembly: { C1: 420, C2: 480, S: 650, M: 900, RE: 1300 },
  side_panel_set: { C1: 700, C2: 850, S: 1650, M: 1200, RE: 1900 },
  front_mudguard: { C1: 380, C2: 450, S: 650, M: 700, RE: 1450 },
  seat_cover: { C1: 220, C2: 250, S: 260, M: 300, RE: 550 },
  speedometer: { C1: 950, C2: 1150, S: 1200, M: 1900, RE: 2900 },
};

const BODY_GROUP_ROWS = `
SPL-G1 | SPL | BS3/BS4 | SPL_BS3, SPL_BS4*
SPL-G2 | SPL | BS6/OBD2 | SPL_BS6*, SPL_OBD2
HFD-G1 | HFD | BS4 | HFD_BS4*
HFD-G2 | HFD | BS6 | HFD_BS6*
PSN-G1 | PSN | BS4 | PSN_BS4*
PSN-G2 | PSN | BS6 | PSN_BS6*
GLM-G1 | GLM | BS4 | GLM_BS4_DR
GLM-G2 | GLM | BS6 | GLM_BS6*
ACT-G1 | ACT | 3G/4G | ACT_3G, ACT_4G
ACT-G2 | ACT | 5G | ACT_5G
ACT-G3 | ACT | 6G | ACT_6G*
A125-G1 | A125 | BS4 | A125_BS4*
A125-G2 | A125 | BS6 | A125_BS6*
SHN-G1 | SHN | BS4 | SHN_BS4*
SHN-G2 | SHN | BS6 | SHN_BS6*
DIO-G1 | DIO | BS4 | DIO_BS4
DIO-G2 | DIO | BS6 | DIO_BS6
P150-G1 | P150 | BS4 | P150_BS4*
P150-G2 | P150 | BS6 | P150_BS6*
PLT-G1 | PLT | BS4 | PLT_BS4*
PLT-G2 | PLT | BS6 | PLT_BS6*
JUP-G1 | JUP | BS4/BS6 | JUP_BS4*, JUP_BS6*
JUP-G2 | JUP | 113 new gen | JUP_NG
APR-G1 | APR | BS4 | APR_BS4*
APR-G2 | APR | BS6 | APR_BS6*
XL-G1 | XL | all | XL_*
NTQ-G1 | NTQ | all | NTQ_*
ACC-G1 | ACC | BS4 | ACC_BS4*
ACC-G2 | ACC | BS6 | ACC_BS6*
FZS-G1 | FZS | V2 | FZS_V2
FZS-G2 | FZS | V3 | FZS_V3*
C350-G1 | C350 | UCE | C350_UCE*
C350-G2 | C350 | J-series | C350_J*
`;

const BODY_TYPES: readonly { code: string; partType: string; label: string; uom: Uom }[] = [
  { code: "HLA", partType: "headlamp_assembly", label: "Headlamp assembly", uom: "pcs" },
  { code: "TLA", partType: "tail_lamp_assembly", label: "Tail lamp assembly", uom: "pcs" },
  { code: "SPS", partType: "side_panel_set", label: "Side panel set", uom: "set" },
  { code: "FMG", partType: "front_mudguard", label: "Front mudguard", uom: "pcs" },
  { code: "STC", partType: "seat_cover", label: "Seat cover", uom: "pcs" },
  { code: "SPD", partType: "speedometer", label: "Speedometer", uom: "pcs" },
];

/** The planted unsourced part (§5.3, §5.5): no preferred supplier, no supplier_parts row. */
export const UNSOURCED_SKU = "SPD-ACT-G1";

function ruleParts(): Part[] {
  const out: Part[] = [];
  const fitsOf = (keys: string[]): Fit[] => keys.map((variantKey) => ({ variantKey, qty: 1 }));

  // Rule A: accelerator cables (wear, pcs); FI covers fi and ei and costs ₹10 more.
  for (const m of MODELS) {
    const vs = VARIANTS.filter((v) => v.modelKey === m.key);
    const price = RULE_PRICES.accelerator_cable[m.priceClass];
    if (m.key === "C350") {
      const groups: [string, string, string[], number][] = [
        ["ACB-C350-CARB", "Accelerator cable Classic 350 carb", ["C350_UCE_BS4"], price],
        ["ACB-C350-FI", "Accelerator cable Classic 350 FI", ["C350_UCE_BS6"], price + 10],
        ["ACB-C350-J", "Accelerator cable Classic 350 J", vs.filter((v) => v.key.startsWith("C350_J")).map((v) => v.key), price + 10],
      ];
      for (const [sku, name, keys, p] of groups) {
        out.push(makePart({ sku, name, oemPartNo: null, category: "wear", partType: "accelerator_cable", uom: "pcs", pricePaise: p * 100, isUniversal: false, isAftermarket: false, fits: fitsOf(keys), s2Code: null }));
      }
      continue;
    }
    const carb = vs.filter((v) => v.fuel === "carb").map((v) => v.key);
    const fi = vs.filter((v) => v.fuel !== "carb").map((v) => v.key);
    if (carb.length > 0) {
      out.push(makePart({ sku: `ACB-${m.key}-CARB`, name: `Accelerator cable ${m.model} carb`, oemPartNo: null, category: "wear", partType: "accelerator_cable", uom: "pcs", pricePaise: price * 100, isUniversal: false, isAftermarket: false, fits: fitsOf(carb), s2Code: null }));
    }
    if (fi.length > 0) {
      out.push(makePart({ sku: `ACB-${m.key}-FI`, name: `Accelerator cable ${m.model} FI`, oemPartNo: m.key === "SPL" ? "17910AAEC00S" : null, category: "wear", partType: "accelerator_cable", uom: "pcs", pricePaise: (price + 10) * 100, isUniversal: false, isAftermarket: false, fits: fitsOf(fi), s2Code: null }));
    }
  }

  // Rule B: carb repair kits (wear, kit), carb variants only; FZ-S has none.
  for (const m of MODELS) {
    const carb = VARIANTS.filter((v) => v.modelKey === m.key && v.fuel === "carb").map((v) => v.key);
    if (carb.length === 0) continue;
    out.push(makePart({ sku: `CRK-${m.key}`, name: `Carburettor repair kit ${m.model}`, oemPartNo: null, category: "wear", partType: "carb_repair_kit", uom: "kit", pricePaise: RULE_PRICES.carb_repair_kit[m.priceClass] * 100, isUniversal: false, isAftermarket: false, fits: fitsOf(carb), s2Code: null }));
  }

  // Rule C: body and electrical parts (model_specific), one per group and type.
  for (const [group, modelKey, label, fits] of rows(BODY_GROUP_ROWS)) {
    const m = MODEL_BY_KEY.get(modelKey)!;
    const fitList = expandFits(fits);
    for (const t of BODY_TYPES) {
      out.push(makePart({ sku: `${t.code}-${group}`, name: `${t.label} ${m.model} ${label}`, oemPartNo: null, category: "model_specific", partType: t.partType, uom: t.uom, pricePaise: RULE_PRICES[t.partType][m.priceClass] * 100, isUniversal: false, isAftermarket: false, fits: fitList.map((f) => ({ ...f })), s2Code: null }));
    }
  }
  return out;
}

function byString<T>(key: (x: T) => string) {
  return (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

export const PARTS: readonly Part[] = (() => {
  const all = [...explicitParts(CONSUMABLE_ROWS, "consumable"), ...explicitParts(WEAR_ROWS, "wear"), ...ruleParts()];
  const seen = new Set<string>();
  for (const p of all) {
    if (seen.has(p.sku)) throw new Error(`duplicate SKU ${p.sku}`);
    seen.add(p.sku);
  }
  return all.sort(byString((p) => p.sku));
})();

export const PART_BY_SKU = new Map(PARTS.map((p) => [p.sku, p]));

// ---------------------------------------------------------------------------------------------
// Supplier rules (§5.3).

export function partMakes(p: Part): Set<string> {
  return new Set(p.fits.map((f) => MODEL_BY_KEY.get(VARIANT_BY_KEY.get(f.variantKey)!.modelKey)!.make));
}

/** A non-universal part with at least one fitment, all of them to C350_* variants. */
export function isRoyalEnfield(p: Part): boolean {
  return !p.isUniversal && p.fits.length > 0 && p.fits.every((f) => f.variantKey.startsWith("C350_"));
}

function isHondaOnly(p: Part): boolean {
  const makes = partMakes(p);
  return makes.size === 1 && makes.has("Honda");
}

const S1_MAKES = new Set(["Hero", "Bajaj", "TVS", "Suzuki", "Yamaha"]);

export function preferredSupplier(p: Part): SupplierKey | null {
  if (p.sku === UNSOURCED_SKU) return null;
  if (isRoyalEnfield(p)) return "S4";
  if (p.category === "model_specific") return isHondaOnly(p) ? "S5" : "S1";
  if (p.category === "consumable" || p.isAftermarket) return "S2";
  return isHondaOnly(p) ? "S2" : "S1"; // wear
}

/** Jaipur's reorder_settings.preferred_supplier_id (§5.3). */
export function jaipurSupplier(p: Part): SupplierKey | null {
  if (p.sku === UNSOURCED_SKU) return null;
  if (!isRoyalEnfield(p) && (p.category === "consumable" || p.category === "wear")) return "S6";
  return "S7";
}

/** supplier_parts rows per the "supplies" column, priced at standard × (100 + pct) / 100. */
export function supplierParts(): { supplier: SupplierKey; sku: string; pricePaise: number; supplierCode: string | null }[] {
  const out: { supplier: SupplierKey; sku: string; pricePaise: number; supplierCode: string | null }[] = [];
  for (const p of PARTS) {
    if (p.sku === UNSOURCED_SKU) continue;
    const re = isRoyalEnfield(p);
    const consumableOrWear = p.category === "consumable" || p.category === "wear";
    const makes = partMakes(p);
    const add = (supplier: SupplierKey, pct: number) =>
      out.push({ supplier, sku: p.sku, pricePaise: (p.pricePaise * (100 + pct)) / 100, supplierCode: supplier === "S2" ? p.s2Code : null });
    const s1 =
      !p.isAftermarket && !p.isUniversal && !re && (p.category === "wear" || p.category === "model_specific") &&
      [...makes].some((m) => S1_MAKES.has(m));
    if (s1) add("S1", 0);
    if (p.category === "consumable" || (p.category === "wear" && !re) || p.isAftermarket) add("S2", 0);
    if (consumableOrWear && !p.isAftermarket) add("S3", 25);
    if (re) add("S4", 0);
    if (p.category === "model_specific" && isHondaOnly(p)) add("S5", 0);
    if ((consumableOrWear || p.isAftermarket) && !re) add("S6", 3);
    if (p.category === "model_specific" || re) add("S7", 5);
    if (consumableOrWear && !p.isAftermarket) add("S8", 30);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// §5.7 Finding types and mappings.

export type AttrKey = "segment" | "brake_front" | "brake_rear" | "start_type" | "wheels" | "emission" | "fuel";
export type Mapping = { partType: string; qty: number; attrKey: AttrKey | null; attrValue: string | null };

export type FindingType = {
  code: string;
  labelEn: string;
  labelHi: string;
  area: "engine" | "brakes" | "drivetrain" | "electrical" | "body" | "tyres_suspension";
  /** Chance a simulated bike of an eligible variant has the finding. */
  freq: (v: Variant) => number;
  eligible: (v: Variant) => boolean;
  mappings: Mapping[];
};

const segmentOf = (v: Variant): Segment => MODEL_BY_KEY.get(v.modelKey)!.segment;
const all = () => true;
const m = (partType: string, attrKey: AttrKey | null = null, attrValue: string | null = null): Mapping => ({ partType, qty: 1, attrKey, attrValue });
const f = (x: number) => () => x;

export const FINDING_TYPES: readonly FindingType[] = [
  { code: "engine_oil_due", labelEn: "Engine oil due", labelHi: "इंजन ऑयल बदलना है", area: "engine", freq: f(0.95), eligible: all, mappings: [m("engine_oil")] },
  { code: "gear_oil_due", labelEn: "Gear oil due", labelHi: "गियर ऑयल बदलना है", area: "engine", freq: f(0.8), eligible: (v) => segmentOf(v) === "scooter", mappings: [m("gear_oil", "segment", "scooter")] },
  { code: "oil_filter_due", labelEn: "Oil filter due", labelHi: "ऑयल फ़िल्टर बदलना है", area: "engine", freq: f(0.9), eligible: (v) => ["P150", "APR", "FZS", "C350"].includes(v.modelKey), mappings: [m("oil_filter")] },
  { code: "air_filter_dirty", labelEn: "Air filter dirty", labelHi: "एयर फ़िल्टर गंदा", area: "engine", freq: f(0.75), eligible: all, mappings: [m("air_filter")] },
  { code: "spark_plug_worn", labelEn: "Spark plug worn", labelHi: "स्पार्क प्लग खराब", area: "engine", freq: f(0.55), eligible: all, mappings: [m("spark_plug")] },
  { code: "carb_needs_overhaul", labelEn: "Carburettor needs overhaul", labelHi: "कार्बोरेटर ओवरहॉल", area: "engine", freq: f(0.15), eligible: (v) => v.fuel === "carb", mappings: [m("carb_repair_kit", "fuel", "carb")] },
  { code: "throttle_cable_sticky", labelEn: "Throttle cable sticky", labelHi: "एक्सीलेटर वायर अटकता है", area: "engine", freq: f(0.15), eligible: all, mappings: [m("accelerator_cable")] },
  { code: "front_brake_worn", labelEn: "Front brake worn", labelHi: "आगे का ब्रेक घिसा", area: "brakes", freq: f(0.45), eligible: all, mappings: [m("front_brake_shoe", "brake_front", "drum"), m("front_brake_pad", "brake_front", "disc")] },
  { code: "rear_brake_worn", labelEn: "Rear brake worn", labelHi: "पीछे का ब्रेक घिसा", area: "brakes", freq: f(0.5), eligible: all, mappings: [m("rear_brake_shoe", "brake_rear", "drum"), m("rear_brake_pad", "brake_rear", "disc")] },
  { code: "brake_fluid_low", labelEn: "Brake fluid low or dark", labelHi: "ब्रेक ऑयल कम", area: "brakes", freq: f(0.3), eligible: (v) => v.brakeFront === "disc", mappings: [m("brake_fluid", "brake_front", "disc")] },
  { code: "chain_sprocket_worn", labelEn: "Chain and sprocket worn", labelHi: "चेन सॉकेट घिसा", area: "drivetrain", freq: f(0.4), eligible: (v) => segmentOf(v) !== "scooter", mappings: [m("chain_sprocket_kit", "segment", "motorcycle"), m("chain_sprocket_kit", "segment", "moped")] },
  { code: "drive_belt_worn", labelEn: "Drive belt worn", labelHi: "बेल्ट घिसी", area: "drivetrain", freq: f(0.25), eligible: (v) => segmentOf(v) === "scooter", mappings: [m("drive_belt", "segment", "scooter")] },
  { code: "clutch_slipping", labelEn: "Clutch slipping", labelHi: "क्लच फिसल रहा है", area: "drivetrain", freq: f(0.12), eligible: (v) => segmentOf(v) === "motorcycle", mappings: [m("clutch_plate_set", "segment", "motorcycle")] },
  { code: "clutch_cable_frayed", labelEn: "Clutch cable frayed", labelHi: "क्लच वायर खराब", area: "drivetrain", freq: f(0.2), eligible: (v) => segmentOf(v) === "motorcycle", mappings: [m("clutch_cable", "segment", "motorcycle")] },
  { code: "battery_weak", labelEn: "Battery weak", labelHi: "बैटरी कमज़ोर", area: "electrical", freq: f(0.35), eligible: all, mappings: [m("battery")] },
  { code: "headlamp_bulb_fused", labelEn: "Headlamp bulb fused", labelHi: "हेडलाइट बल्ब फ्यूज़", area: "electrical", freq: f(0.15), eligible: all, mappings: [m("headlamp_bulb")] },
  { code: "headlamp_broken", labelEn: "Headlamp broken", labelHi: "हेडलाइट टूटी", area: "electrical", freq: f(0.05), eligible: all, mappings: [m("headlamp_assembly")] },
  { code: "indicator_broken", labelEn: "Indicator broken", labelHi: "इंडिकेटर टूटा", area: "electrical", freq: f(0.15), eligible: all, mappings: [m("turn_indicator")] },
  { code: "tail_lamp_broken", labelEn: "Tail lamp broken", labelHi: "टेल लाइट टूटी", area: "electrical", freq: f(0.06), eligible: all, mappings: [m("tail_lamp_assembly")] },
  { code: "speedometer_not_working", labelEn: "Speedometer not working", labelHi: "मीटर बंद", area: "electrical", freq: f(0.06), eligible: all, mappings: [m("speedometer")] },
  { code: "mirror_missing_broken", labelEn: "Mirror missing or broken", labelHi: "शीशा टूटा या गायब", area: "body", freq: f(0.3), eligible: all, mappings: [m("mirror_set")] },
  { code: "side_panel_cracked", labelEn: "Side panel cracked", labelHi: "साइड पैनल टूटा", area: "body", freq: (v) => (segmentOf(v) === "scooter" ? 0.3 : 0.12), eligible: all, mappings: [m("side_panel_set")] },
  { code: "front_mudguard_cracked", labelEn: "Front mudguard cracked", labelHi: "आगे का मडगार्ड टूटा", area: "body", freq: f(0.08), eligible: all, mappings: [m("front_mudguard")] },
  { code: "seat_cover_torn", labelEn: "Seat cover torn", labelHi: "सीट कवर फटा", area: "body", freq: f(0.25), eligible: all, mappings: [m("seat_cover")] },
  { code: "rear_tyre_worn", labelEn: "Rear tyre worn", labelHi: "पिछला टायर घिसा", area: "tyres_suspension", freq: f(0.25), eligible: all, mappings: [m("rear_tyre")] },
  { code: "front_tyre_worn", labelEn: "Front tyre worn", labelHi: "अगला टायर घिसा", area: "tyres_suspension", freq: f(0.15), eligible: all, mappings: [m("front_tyre")] },
  { code: "rear_shock_leaking", labelEn: "Rear shock leaking", labelHi: "शॉकर लीक", area: "tyres_suspension", freq: f(0.08), eligible: all, mappings: [m("rear_shock")] },
  { code: "fork_seal_leaking", labelEn: "Front fork seal leaking", labelHi: "फोर्क सील लीक", area: "tyres_suspension", freq: f(0.1), eligible: (v) => !["ACT_3G", "ACT_4G", "ACT_5G"].includes(v.key), mappings: [m("fork_seal_kit")] },
];

export const FINDING_BY_CODE = new Map(FINDING_TYPES.map((t) => [t.code, t]));

/** The bike attribute a mapping row is keyed on; unknown variant knows only the segment. */
function attrValue(key: AttrKey, modelKey: string, v: Variant | null): string | null {
  if (key === "segment") return MODEL_BY_KEY.get(modelKey)!.segment;
  if (!v) return null;
  return { brake_front: v.brakeFront, brake_rear: v.brakeRear, start_type: v.startType, wheels: v.wheels, emission: v.emission, fuel: v.fuel }[key];
}

/** SPEC §9.1 step 1: the applicable mapping row (at most one). */
export function applicableMapping(code: string, modelKey: string, v: Variant | null): Mapping | null {
  const t = FINDING_BY_CODE.get(code)!;
  return t.mappings.find((mp) => mp.attrKey === null || mp.attrValue === attrValue(mp.attrKey, modelKey, v)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Fitment state and the SPEC §9.1 auto-pick (mirror of public.part_candidates).

export type Fitment = {
  sku: string;
  variantKey: string;
  qtyPerBike: number;
  source: "catalogue" | "learned";
  confirmed: number;
  flagged: number;
};

/** Catalogue fitments with their starting counts (OEM 12, aftermarket 2, flagged 0). */
export function catalogueFitments(): Fitment[] {
  const out: Fitment[] = [];
  for (const p of PARTS) {
    for (const fit of p.fits) {
      out.push({ sku: p.sku, variantKey: fit.variantKey, qtyPerBike: fit.qty, source: "catalogue", confirmed: p.isAftermarket ? 2 : 12, flagged: 0 });
    }
  }
  return out;
}

export const PARTS_BY_TYPE = (() => {
  const map = new Map<string, Part[]>();
  for (const p of PARTS) map.set(p.partType, [...(map.get(p.partType) ?? []), p]);
  return map;
})();

export type Pick = { sku: string; qty: number };

/**
 * The auto-picked part for a finding on a bike, or null (unresolved). `fitment(sku, variant)`
 * reads the current fitment state. qty = fitment qty_per_bike ?? mapping qty (findings carry no qty).
 */
export function autoPick(
  code: string,
  modelKey: string,
  variantKey: string | null,
  fitment: (sku: string, variantKey: string) => Fitment | undefined,
): Pick | null {
  const v = variantKey ? VARIANT_BY_KEY.get(variantKey)! : null;
  const mapping = applicableMapping(code, modelKey, v);
  if (!mapping) return null;
  const parts = PARTS_BY_TYPE.get(mapping.partType) ?? [];
  type Cand = { part: Part; fit: Fitment | undefined };
  const specific: Cand[] = variantKey
    ? parts
        .map((part) => ({ part, fit: fitment(part.sku, variantKey) }))
        .filter((c): c is { part: Part; fit: Fitment } => !!c.fit && (c.fit.source === "catalogue" || c.fit.confirmed >= 1))
    : [];
  const cands: Cand[] =
    specific.length > 0
      ? specific
      : parts.filter((p) => p.isUniversal).map((part) => ({ part, fit: variantKey ? fitment(part.sku, variantKey) : undefined }));
  const scored = cands
    .map((c) => {
      const confirmed = c.fit?.confirmed ?? 0;
      const flagged = c.fit?.flagged ?? 0;
      return { c, confirmed, flagged, auto: flagged < Math.max(1, confirmed), src: c.fit ? (c.fit.source === "catalogue" ? 0 : 1) : 2 };
    })
    .filter((x) => x.auto)
    .sort((a, b) => a.src - b.src || b.confirmed - b.flagged - (a.confirmed - a.flagged) || a.c.part.pricePaise - b.c.part.pricePaise || (a.c.part.sku < b.c.part.sku ? -1 : 1));
  const best = scored[0];
  if (!best) return null;
  return { sku: best.c.part.sku, qty: best.c.fit?.qtyPerBike ?? mapping.qty };
}

// ---------------------------------------------------------------------------------------------
// §5.8 Bins.

export type Zone = "A" | "B" | "C" | "D" | "E";

const BIN_SPECS: Record<WorkshopCode, string[]> = {
  NCR: ["A01:4", "A02:4", "B01:4", "B02:4", "C01:4", "C02:3", "D01:4", "E01:4", "E02:4", "E03:4"],
  JPR: ["A01:3", "B01:3", "C01:2", "D01:2", "E01:3"],
};

/** Normal bin codes per workshop and zone, in order. */
export function normalBins(ws: WorkshopCode): Record<Zone, string[]> {
  const out: Record<Zone, string[]> = { A: [], B: [], C: [], D: [], E: [] };
  for (const spec of BIN_SPECS[ws]) {
    const [rack, n] = spec.split(":");
    for (let i = 1; i <= Number(n); i++) out[rack[0] as Zone].push(`${ws}-${rack}-${String(i).padStart(2, "0")}`);
  }
  return out;
}

export function zoneOf(partType: string): Zone {
  if (["engine_oil", "gear_oil", "brake_fluid", "spark_plug", "air_filter", "oil_filter"].includes(partType)) return "A";
  if (partType.endsWith("_brake_shoe") || partType.endsWith("_brake_pad") || partType.endsWith("_cable")) return "B";
  if (["chain_sprocket_kit", "clutch_plate_set", "drive_belt", "battery", "rear_shock", "fork_seal_kit", "carb_repair_kit"].includes(partType)) return "C";
  if (["headlamp_bulb", "turn_indicator", "headlamp_assembly", "tail_lamp_assembly", "speedometer"].includes(partType)) return "D";
  return "E";
}

/** Home bin per SKU: round-robin in SKU order within the zone. */
export function homeBins(ws: WorkshopCode): Map<string, string> {
  const bins = normalBins(ws);
  const next: Record<Zone, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const out = new Map<string, string>();
  for (const p of PARTS) {
    const z = zoneOf(p.partType);
    out.set(p.sku, bins[z][next[z] % bins[z].length]);
    next[z]++;
  }
  return out;
}

/** A second bin in the same zone (the next one after home). */
export function secondBin(ws: WorkshopCode, sku: string): string {
  const z = zoneOf(PART_BY_SKU.get(sku)!.partType);
  const bins = normalBins(ws)[z];
  const home = homeBins(ws).get(sku)!;
  return bins[(bins.indexOf(home) + 1) % bins.length];
}

// ---------------------------------------------------------------------------------------------
// §5.9 Expected demand, reorder settings, planted dead stock.

export const BIKES_PER_DAY: Record<WorkshopCode, number> = { NCR: 32, JPR: 6.5 };

/** Expected daily demand per SKU for a workshop, from the catalogue fitments. */
export function expectedDemand(ws: WorkshopCode): Map<string, number> {
  const fits = new Map(catalogueFitments().map((x) => [`${x.sku}|${x.variantKey}`, x]));
  const lookup = (sku: string, vk: string) => fits.get(`${sku}|${vk}`);
  const out = new Map<string, number>();
  for (const model of MODELS) {
    for (const v of VARIANTS.filter((x) => x.modelKey === model.key)) {
      const share = BIKES_PER_DAY[ws] * (model.mix / 100) * (v.weight / 100);
      for (const t of FINDING_TYPES) {
        if (!t.eligible(v)) continue;
        const pick = autoPick(t.code, model.key, v.key, lookup);
        if (!pick) continue;
        out.set(pick.sku, (out.get(pick.sku) ?? 0) + share * t.freq(v) * pick.qty);
      }
    }
  }
  return out;
}

export type ReorderSetting = { auto: boolean; safetyStock: number; maxQty: number };

export function reorderSettings(ws: WorkshopCode): Map<string, ReorderSetting> {
  const demand = expectedDemand(ws);
  const out = new Map<string, ReorderSetting>();
  for (const p of PARTS) {
    const d = demand.get(p.sku) ?? 0;
    if (d >= 0.2 && p.category !== "model_specific" && !p.isAftermarket) {
      const safetyStock = Math.ceil(d * 2);
      out.set(p.sku, { auto: true, safetyStock, maxQty: Math.max(safetyStock + 2, Math.ceil(d * 12)) });
    } else {
      out.set(p.sku, { auto: false, safetyStock: 0, maxQty: 1 });
    }
  }
  return out;
}

/** The 5 fastest movers by expected demand (they also hold stock in a second bin). */
export function fastestMovers(ws: WorkshopCode): string[] {
  return [...expectedDemand(ws).entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([sku]) => sku);
}

/** Planted dead stock (opening stock only) with its unit count. */
export const DEAD_STOCK: Record<WorkshopCode, [string, number][]> = {
  NCR: [["SPS-ACT-G1", 2], ["FMG-ACT-G1", 3], ["CRK-C350", 2], ["HLA-FZS-G1", 1], ["TLA-FZS-G1", 2], ["SPS-P150-G1", 1], ["HLA-GLM-G1", 2], ["STC-PSN-G1", 4], ["SPD-HFD-G1", 1], ["CRK-APR", 3]],
  JPR: [["HLA-APR-G1", 1], ["SPS-NTQ-G1", 2], ["FMG-ACC-G1", 2], ["STC-JUP-G2", 3], ["CRK-NTQ", 2], ["SPS-DIO-G1", 1], ["TLA-PLT-G1", 2], ["HLA-A125-G1", 1]],
};

/** The flagged-fitment note (§5.9). */
export const FLAG_NOTE = "Airbox clip does not match BS6 housing";
