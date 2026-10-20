# Vutto seed catalogue

This is the reference data the seed generator uses. Models, variant years, brake/wheel/fuel facts and the part numbers named below come from public sources checked in October 2026: Hero Genuine Parts listings, Rushlane, BikeDekho, IAMABIKER, Autocar India, Exide and Uno Minda catalogues. Prices are rounded ₹ including GST. They are realistic Delhi trade prices, not quotes. Anything marked (est.) is an estimate.

**Rules for Claude Code**
- Use exactly the models, variants, parts, fitments, finding types, suppliers and bins in this file. Do not invent others.
- Where a family of parts is defined by a rule (§5.5), generate exactly the SKUs the rule describes, no more.
- Variant keys like `SPL_BS4_K` are seed-only identifiers. Use them as UUIDv5 names; do not store them. The variant `name` column is what users see.
- In a fits list, `SPL_*` means every variant whose key starts with `SPL_`, and `SPL_BS6*` means every key that starts with `SPL_BS6`. A key without `*` means exactly that variant.
- A fitment's `qty_per_bike` is 1 unless the row says `×N`.
- Every fitment in this file has `source = catalogue`, except the one planted learned fitment in §5.9. OEM parts start with `confirmed_count = 12` and aftermarket parts with `confirmed_count = 2`, representing history before the seeded period. Every fitment starts with `flagged_count = 0`, except the planted one.
- `universal` in a fits column means `is_universal = true` and no fitment rows.
- `standard_price_paise = ₹ × 100`.
- `alt ₹X` on a row means: also create an aftermarket SKU with the same part_type and fitments. It gets SKU suffix `-AM`, the name with " (aftermarket)" appended, price ₹X and preferred supplier S2. The OEM SKU still wins auto-pick because it has the higher confirmed_count.

### 5.1 Models and mix (same mix for both workshops; no public data splits them)

| key | make | model | segment | mix % |
|---|---|---|---|---|
| SPL | Hero | Splendor Plus | motorcycle | 18 |
| ACT | Honda | Activa 110 | scooter | 14 |
| HFD | Hero | HF Deluxe | motorcycle | 9 |
| SHN | Honda | Shine 125 | motorcycle | 8 |
| P150 | Bajaj | Pulsar 150 | motorcycle | 7 |
| JUP | TVS | Jupiter | scooter | 7 |
| ACC | Suzuki | Access 125 | scooter | 5 |
| C350 | Royal Enfield | Classic 350 | motorcycle | 5 |
| PLT | Bajaj | Platina 100 | motorcycle | 4 |
| APR | TVS | Apache RTR 160 2V | motorcycle | 4 |
| GLM | Hero | Glamour | motorcycle | 3 |
| PSN | Hero | Passion Pro | motorcycle | 3 |
| A125 | Honda | Activa 125 | scooter | 3 |
| DIO | Honda | Dio | scooter | 3 |
| FZS | Yamaha | FZ-S | motorcycle | 3 |
| XL | TVS | XL100 | moped | 3 |
| NTQ | TVS | Ntorq 125 | scooter | 1 |

Source of the mix: August 2024 new-sales ranking (Rushlane) as a proxy for used supply. Splendor 3.03 lakh, Activa 2.27 lakh, Shine 1.50 lakh, Pulsar 1.16 lakh, Jupiter 89k, HF Deluxe 85k, Access 62k, XL 45k, Platina 42k, Dio 35k. Classic 350 and FZ-S are added because they are common in the used market.

### 5.2 Variants

Columns: key, name, year_from–year_to (blank end = still sold), brake front/rear, start_type, wheels, emission, fuel, w = weight within the model (each model's weights sum to 100).

The generator picks a variant by w, then mfg_year uniformly from [year_from, min(year_to or 2025, 2025)]. Every simulated bike has a variant. Only the planted unknown-variant bikes (one per workshop, SPEC §15) have variant_id null.

| key | name | years | F/R | start | wheels | emission | fuel | w |
|---|---|---|---|---|---|---|---|---|
| SPL_BS3 | BS3 Self Spoke | 2015–2017 | drum/drum | kick_self | spoke | bs3 | carb | 10 |
| SPL_BS4_K | BS4 Kick Alloy | 2017–2020 | drum/drum | kick | alloy | bs4 | carb | 15 |
| SPL_BS4_S | BS4 Self Alloy | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 20 |
| SPL_BS6_K | BS6 Kick Alloy | 2020–2023 | drum/drum | kick | alloy | bs6 | fi | 15 |
| SPL_BS6_S | BS6 Self Alloy i3S | 2020–2023 | drum/drum | kick_self | alloy | bs6 | fi | 25 |
| SPL_OBD2 | OBD2 Self Alloy (incl. Xtec) | 2023– | drum/drum | kick_self | alloy | bs6_obd2 | fi | 15 |
| HFD_BS4_K | BS4 Kick Spoke | 2017–2020 | drum/drum | kick | spoke | bs4 | carb | 25 |
| HFD_BS4_S | BS4 Self Alloy | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 20 |
| HFD_BS6_K | BS6 Kick Spoke | 2020– | drum/drum | kick | spoke | bs6 | fi | 30 |
| HFD_BS6_S | BS6 Self Alloy | 2020– | drum/drum | kick_self | alloy | bs6 | fi | 25 |
| PSN_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 25 |
| PSN_BS4_DI | BS4 Disc | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 20 |
| PSN_BS6_DR | BS6 Drum | 2020–2023 | drum/drum | kick_self | alloy | bs6 | fi | 30 |
| PSN_BS6_DI | BS6 Disc | 2020–2023 | disc/drum | kick_self | alloy | bs6 | fi | 25 |
| GLM_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 35 |
| GLM_BS6_DR | BS6 Drum | 2020– | drum/drum | kick_self | alloy | bs6 | fi | 35 |
| GLM_BS6_DI | BS6 Disc | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 30 |
| ACT_3G | 3G | 2015–2017 | drum/drum | kick_self | steel | bs3 | carb | 10 |
| ACT_4G | 4G | 2017–2018 | drum/drum | kick_self | steel | bs4 | carb | 15 |
| ACT_5G | 5G (10-inch front) | 2018–2020 | drum/drum | kick_self | steel | bs4 | carb | 25 |
| ACT_6G | 6G (12-inch front, telescopic fork) | 2020–2023 | drum/drum | kick_self | steel | bs6 | fi | 35 |
| ACT_6G_OBD2 | 6G OBD2 | 2023– | drum/drum | kick_self | steel | bs6_obd2 | fi | 15 |
| A125_BS4_DR | BS4 Drum | 2017–2019 | drum/drum | kick_self | steel | bs4 | carb | 25 |
| A125_BS4_DI | BS4 Disc Deluxe | 2017–2019 | disc/drum | kick_self | alloy | bs4 | carb | 15 |
| A125_BS6_DR | BS6 Drum | 2019– | drum/drum | self | steel | bs6 | fi | 35 |
| A125_BS6_DI | BS6 Disc Deluxe | 2019– | disc/drum | self | alloy | bs6 | fi | 25 |
| SHN_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 30 |
| SHN_BS4_DI | BS4 Disc | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 15 |
| SHN_BS6_DR | BS6 Drum | 2020– | drum/drum | self | alloy | bs6 | fi | 35 |
| SHN_BS6_DI | BS6 Disc | 2020– | disc/drum | self | alloy | bs6 | fi | 20 |
| DIO_BS4 | BS4 | 2017–2020 | drum/drum | kick_self | steel | bs4 | carb | 45 |
| DIO_BS6 | BS6 | 2020– | drum/drum | kick_self | steel | bs6 | fi | 55 |
| P150_BS4_SD | BS4 Standard (240mm disc) | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 40 |
| P150_BS4_TD | BS4 Twin Disc (260mm) | 2017–2020 | disc/disc | kick_self | alloy | bs4 | carb | 15 |
| P150_BS6_SD | BS6 Standard (260mm disc) | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 30 |
| P150_BS6_TD | BS6 Twin Disc | 2020– | disc/disc | kick_self | alloy | bs6 | fi | 15 |
| PLT_BS4_K | BS4 KS Spoke | 2017–2020 | drum/drum | kick | spoke | bs4 | carb | 25 |
| PLT_BS4_S | BS4 ES Alloy | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 20 |
| PLT_BS6_K | BS6 KS Alloy | 2020– | drum/drum | kick | alloy | bs6 | ei | 25 |
| PLT_BS6_S | BS6 ES Alloy | 2020– | drum/drum | kick_self | alloy | bs6 | ei | 30 |
| JUP_BS4_BASE | BS4 Base | 2017–2020 | drum/drum | kick_self | steel | bs4 | carb | 20 |
| JUP_BS4_ZX | BS4 ZX | 2017–2020 | drum/drum | kick_self | alloy | bs4 | carb | 15 |
| JUP_BS6_DR | BS6 Drum | 2020–2024 | drum/drum | kick_self | alloy | bs6 | fi | 30 |
| JUP_BS6_DI | BS6 ZX Disc | 2020–2024 | disc/drum | kick_self | alloy | bs6 | fi | 20 |
| JUP_NG | New generation 113cc | 2024– | drum/drum | kick_self | alloy | bs6_obd2 | fi | 15 |
| APR_BS4_RD | BS4 Rear Drum | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 30 |
| APR_BS4_TD | BS4 Rear Disc | 2017–2020 | disc/disc | kick_self | alloy | bs4 | carb | 20 |
| APR_BS6_RD | BS6 Rear Drum | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 30 |
| APR_BS6_TD | BS6 Twin Disc | 2020– | disc/disc | kick_self | alloy | bs6 | fi | 20 |
| XL_BS4_K | BS4 Heavy Duty (kick) | 2017–2020 | drum/drum | kick | spoke | bs4 | carb | 30 |
| XL_BS4_S | BS4 i-Touchstart | 2017–2020 | drum/drum | kick_self | spoke | bs4 | carb | 20 |
| XL_BS6_K | BS6 Heavy Duty (kick) | 2020– | drum/drum | kick | spoke | bs6 | fi | 25 |
| XL_BS6_S | BS6 i-Touchstart | 2020– | drum/drum | kick_self | spoke | bs6 | fi | 25 |
| NTQ_BS4 | BS4 Disc | 2018–2020 | disc/drum | kick_self | alloy | bs4 | carb | 35 |
| NTQ_BS6 | BS6 Disc | 2020– | disc/drum | kick_self | alloy | bs6 | fi | 65 |
| ACC_BS4_DR | BS4 Drum | 2017–2020 | drum/drum | kick_self | steel | bs4 | carb | 25 |
| ACC_BS4_DI | BS4 Disc | 2017–2020 | disc/drum | kick_self | alloy | bs4 | carb | 15 |
| ACC_BS6_DR | BS6 Drum | 2020–2025 | drum/drum | kick_self | alloy | bs6 | fi | 35 |
| ACC_BS6_DI | BS6 Disc | 2020–2025 | disc/drum | kick_self | alloy | bs6 | fi | 25 |
| FZS_V2 | V2.0 FI | 2017–2019 | disc/drum | self | alloy | bs4 | fi | 35 |
| FZS_V3_BS4 | V3.0 BS4 (ABS) | 2019–2020 | disc/disc | self | alloy | bs4 | fi | 20 |
| FZS_V3_BS6 | V3.0 BS6 (ABS) | 2020– | disc/disc | self | alloy | bs6 | fi | 45 |
| C350_UCE_BS4 | UCE BS4 (carb) | 2017–2020 | disc/drum | kick_self | spoke | bs4 | carb | 35 |
| C350_UCE_BS6 | UCE BS6 (EFI) | 2020–2021 | disc/drum | kick_self | spoke | bs6 | fi | 15 |
| C350_J_RED | J-series Redditch (single-channel ABS) | 2021–2024 | disc/drum | self | spoke | bs6 | fi | 25 |
| C350_J_SIG | J-series Signals (dual-channel ABS) | 2021–2024 | disc/disc | self | spoke | bs6 | fi | 25 |

Facts this table encodes (use them in the demo): Activa 5G has a 10-inch front wheel and 6G has 12-inch with a telescopic fork. Pulsar 150 BS4 Standard uses a 240mm front disc, while the BS6 uses 260mm. BS6 Platina uses Bajaj's own "EI" injection, not a carburettor. Classic 350 UCE and J-series share almost no mechanical parts, and the J has no kick lever.

### 5.3 Suppliers

| id | name | city | kind | lead days | supplies |
|---|---|---|---|---|---|
| S1 | NCR OEM Parts Distributor | Delhi | oem_dealer | 3 | OEM wear and model-specific parts for Hero, Bajaj, TVS, Suzuki and Yamaha |
| S2 | Kashmere Gate Wholesale Spares | Delhi | wholesaler | 1 | all consumables; all wear parts except Royal Enfield; all aftermarket SKUs |
| S3 | Karol Bagh Spares Counter | Delhi | local_market | 0 | consumables and wear parts at +25%; never preferred (emergency reference only) |
| S4 | RE Authorised Parts Distributor | Delhi | oem_dealer | 5 | all Royal Enfield parts |
| S5 | Honda Authorised Dealer Parts Desk | Delhi | oem_dealer | 7 | Honda model-specific parts (dealers often do not sell over the counter, hence the long lead) |
| S6 | Jaipur Spares Wholesale | Jaipur | wholesaler | 2 | consumables, wear and aftermarket parts (not Royal Enfield) at +3% |
| S7 | Jaipur OEM Parts Distributor | Jaipur | oem_dealer | 4 | model-specific and Royal Enfield parts at +5% |
| S8 | Jaipur Local Spares Shop | Jaipur | local_market | 0 | consumables and wear parts at +30%; never preferred |

- Phones are obviously fake, e.g. `+91 90000 0000N`. Names are generic descriptions, not real businesses.
- A "Royal Enfield part" is a non-universal part with at least one fitment, all of them to C350_* variants (universal parts are never Royal Enfield parts).
- parts.preferred_supplier_id works like this:
  - Royal Enfield parts → S4.
  - Honda model_specific parts → S5.
  - Other model_specific parts and OEM wear parts → S1.
  - Consumables and aftermarket → S2.
  - Honda wear parts → S2 (genuine Honda wear parts are common in the Kashmere Gate trade).
- Jaipur sets reorder_settings.preferred_supplier_id on every (JPR, part) row: S6 for consumables, wear and aftermarket parts (except Royal Enfield), and S7 for everything else. The one exception is the planted unsourced part, which has no supplier at either workshop.
- supplier_parts gets a row for every (supplier, part) the "supplies" column covers. The price is the standard price, adjusted by the percentage shown. supplier_code is set where §5.4 names a brand part number.
- Planted unsourced part: the Activa 3G/4G speedometer (§5.5) has no preferred supplier and no supplier_parts row, because it is discontinued.

### 5.4 Parts with explicit fitments

Columns: SKU, name (ASCII, printed on POs), part_type, uom, ₹, fits. Every row has category `consumable` or `wear`, as its heading says.

**Consumables**

| SKU | name | part_type | uom | ₹ | fits |
|---|---|---|---|---|---|
| OIL-20W40-1L | Engine oil 20W40 JASO MA 1L | engine_oil | bottle | 380 | SPL_*, HFD_*, PSN_*, GLM_*, SHN_*, P150_*, PLT_*, APR_*, FZS_*, XL_* |
| OIL-10W30-SC-08L | Scooter engine oil 10W30 JASO MB 0.8L | engine_oil | bottle | 330 | ACT_*, A125_*, DIO_*, JUP_*, NTQ_*, ACC_* |
| OIL-15W50-RE-1L | Engine oil 15W50 1L (Royal Enfield) | engine_oil | bottle | 650 | C350_UCE* ×3, C350_J* ×2 |
| GOIL-SC-120ML | Scooter gear oil 120ml | gear_oil | bottle | 110 | ACT_*, A125_*, DIO_*, JUP_*, NTQ_*, ACC_* |
| BFL-DOT3-100ML | Brake fluid DOT3 100ml | brake_fluid | bottle | 90 | universal |
| BLB-HL-3535 | Headlamp bulb 12V 35/35W | headlamp_bulb | pcs | 90 | universal |
| BLB-HL-H4-RE | Headlamp bulb H4 12V 60/55W | headlamp_bulb | pcs | 280 | C350_* |
| IND-UNIV-PAIR | Turn indicator assembly 12V (pair) | turn_indicator | pair | 280 | universal |
| SP-HERO-100 | Spark plug Hero 100-113cc | spark_plug | pcs | 120 | SPL_*, HFD_*, PSN_* |
| SP-HERO-125 | Spark plug Hero Glamour 125 | spark_plug | pcs | 130 | GLM_* |
| SP-HON-SC | Spark plug Honda scooter | spark_plug | pcs | 140 | ACT_*, A125_*, DIO_* |
| SP-HON-SHN | Spark plug Honda Shine 125 | spark_plug | pcs | 140 | SHN_* |
| SP-BAJ-150 | Spark plug Pulsar 150 DTS-i | spark_plug | pcs | 150 | P150_* ×2 (twin-spark engine) |
| SP-BAJ-100 | Spark plug Platina 100 | spark_plug | pcs | 110 | PLT_* |
| SP-TVS-110 | Spark plug TVS 100-125cc | spark_plug | pcs | 130 | JUP_*, NTQ_*, XL_* |
| SP-TVS-160 | Spark plug Apache RTR 160 | spark_plug | pcs | 160 | APR_* |
| SP-SUZ-125 | Spark plug Suzuki Access 125 | spark_plug | pcs | 140 | ACC_* |
| SP-YAM-FZ | Spark plug Yamaha FZ-S | spark_plug | pcs | 170 | FZS_* |
| SP-RE-350 | Spark plug Royal Enfield 350 | spark_plug | pcs | 180 | C350_* |
| AF-HERO-CARB | Air filter Hero 100cc carb | air_filter | pcs | 170 | SPL_BS3, SPL_BS4*, HFD_BS4*, PSN_BS4* |
| AF-HERO-BS6 | Air filter Hero BS6 (17208AABA00S) | air_filter | pcs | 155 | SPL_BS6*, SPL_OBD2, HFD_BS6*, PSN_BS6*, GLM_BS6* (oem_part_no 17208AABA00S) |
| AF-GLM-BS4 | Air filter Glamour BS4 | air_filter | pcs | 210 | GLM_BS4_DR |
| AF-ACT-CARB | Air filter Activa 3G-5G / Dio BS4 | air_filter | pcs | 220 | ACT_3G, ACT_4G, ACT_5G, DIO_BS4 |
| AF-ACT-6G | Air filter Activa 6G / Dio BS6 | air_filter | pcs | 240 | ACT_6G*, DIO_BS6 |
| AF-A125 | Air filter Activa 125 | air_filter | pcs | 250 | A125_* |
| AF-SHN-BS4 | Air filter Shine 125 BS4 | air_filter | pcs | 230 | SHN_BS4* |
| AF-SHN-BS6 | Air filter Shine 125 BS6 | air_filter | pcs | 240 | SHN_BS6* |
| AF-P150 | Air filter Pulsar 150 | air_filter | pcs | 260 | P150_* |
| AF-PLT | Air filter Platina 100 | air_filter | pcs | 180 | PLT_* |
| AF-JUP | Air filter Jupiter BS4 | air_filter | pcs | 230 | JUP_BS4* |
| AF-JUP-BS6 | Air filter Jupiter BS6 | air_filter | pcs | 240 | JUP_BS6* |
| AF-JUP-NG | Air filter Jupiter 113 | air_filter | pcs | 260 | JUP_NG |
| AF-APR | Air filter Apache RTR 160 | air_filter | pcs | 300 | APR_* |
| AF-XL | Air filter XL100 | air_filter | pcs | 150 | XL_* |
| AF-NTQ | Air filter Ntorq 125 | air_filter | pcs | 280 | NTQ_* |
| AF-ACC | Air filter Access 125 | air_filter | pcs | 240 | ACC_* |
| AF-FZ | Air filter FZ-S | air_filter | pcs | 350 | FZS_* |
| AF-RE-UCE | Air filter Classic 350 UCE | air_filter | pcs | 550 | C350_UCE* |
| AF-RE-J | Air filter Classic 350 J | air_filter | pcs | 650 | C350_J* |
| OF-P150 | Oil filter Pulsar 150 | oil_filter | pcs | 140 | P150_* |
| OF-APR | Oil filter Apache RTR 160 | oil_filter | pcs | 160 | APR_* |
| OF-FZ | Oil filter FZ-S | oil_filter | pcs | 180 | FZS_* |
| OF-RE-UCE | Oil filter Classic 350 UCE | oil_filter | pcs | 220 | C350_UCE* |
| OF-RE-J | Oil filter Classic 350 J | oil_filter | pcs | 250 | C350_J* |

**Wear parts: brakes**

| SKU | name | part_type | uom | ₹ | fits |
|---|---|---|---|---|---|
| FBS-HERO-130 | Front brake shoe set Hero 130mm | front_brake_shoe | set | 220, alt 150 | SPL_*, HFD_*, PSN_BS4_DR, PSN_BS6_DR, GLM_BS4_DR, GLM_BS6_DR |
| FBS-HON-SC | Front brake shoe set Honda scooter 130mm | front_brake_shoe | set | 260 | ACT_*, A125_BS4_DR, A125_BS6_DR, DIO_* |
| FBS-SHN | Front brake shoe set Shine 125 | front_brake_shoe | set | 250 | SHN_BS4_DR, SHN_BS6_DR |
| FBS-PLT | Front brake shoe set Platina 100 | front_brake_shoe | set | 210 | PLT_* |
| FBS-TVS-SC | Front brake shoe set Jupiter | front_brake_shoe | set | 240 | JUP_BS4*, JUP_BS6_DR, JUP_NG |
| FBS-XL | Front brake shoe set XL100 | front_brake_shoe | set | 180 | XL_* |
| FBS-ACC | Front brake shoe set Access 125 | front_brake_shoe | set | 250 | ACC_BS4_DR, ACC_BS6_DR |
| RBS-HERO-130 | Rear brake shoe set Hero 130mm | rear_brake_shoe | set | 220, alt 150 | SPL_*, HFD_*, PSN_*, GLM_* |
| RBS-HON-SC | Rear brake shoe set Honda scooter 130mm | rear_brake_shoe | set | 260 | ACT_*, A125_*, DIO_* |
| RBS-SHN | Rear brake shoe set Shine 125 | rear_brake_shoe | set | 250 | SHN_* |
| RBS-P150 | Rear brake shoe set Pulsar 150 | rear_brake_shoe | set | 280 | P150_BS4_SD, P150_BS6_SD |
| RBS-PLT | Rear brake shoe set Platina 100 | rear_brake_shoe | set | 210 | PLT_* |
| RBS-TVS-SC | Rear brake shoe set Jupiter / Ntorq | rear_brake_shoe | set | 240 | JUP_*, NTQ_* |
| RBS-APR | Rear brake shoe set Apache RTR 160 | rear_brake_shoe | set | 280 | APR_BS4_RD, APR_BS6_RD |
| RBS-XL | Rear brake shoe set XL100 | rear_brake_shoe | set | 180 | XL_* |
| RBS-ACC | Rear brake shoe set Access 125 | rear_brake_shoe | set | 250 | ACC_* |
| RBS-FZ | Rear brake shoe set FZ-S V2 | rear_brake_shoe | set | 300 | FZS_V2 |
| RBS-RE-153 | Rear brake shoe set Royal Enfield 153mm | rear_brake_shoe | set | 450 | C350_UCE*, C350_J_RED |
| FBP-HERO | Front brake pads Hero disc | front_brake_pad | set | 320 | PSN_BS4_DI, PSN_BS6_DI, GLM_BS6_DI |
| FBP-HON | Front brake pads Honda disc | front_brake_pad | set | 350 | A125_BS4_DI, A125_BS6_DI, SHN_BS4_DI, SHN_BS6_DI |
| FBP-P150-240 | Front brake pads Pulsar 150 (240mm) | front_brake_pad | set | 380 | P150_BS4_SD |
| FBP-P150-260 | Front brake pads Pulsar 150 (260mm) | front_brake_pad | set | 420 | P150_BS4_TD, P150_BS6* |
| FBP-TVS-SC | Front brake pads Jupiter / Ntorq | front_brake_pad | set | 340 | JUP_BS6_DI, NTQ_* |
| FBP-APR | Front brake pads Apache RTR 160 | front_brake_pad | set | 450 | APR_* |
| FBP-ACC | Front brake pads Access 125 | front_brake_pad | set | 350 | ACC_BS4_DI, ACC_BS6_DI |
| FBP-FZ | Front brake pads FZ-S | front_brake_pad | set | 480 | FZS_* |
| FBP-RE-UCE | Front brake pads Classic 350 UCE (280mm) | front_brake_pad | set | 650 | C350_UCE* |
| FBP-RE-J | Front brake pads Classic 350 J (300mm) | front_brake_pad | set | 750 | C350_J* |
| RBP-P150 | Rear brake pads Pulsar 150 Twin Disc | rear_brake_pad | set | 400 | P150_BS4_TD, P150_BS6_TD |
| RBP-APR | Rear brake pads Apache RTR 160 | rear_brake_pad | set | 420 | APR_BS4_TD, APR_BS6_TD |
| RBP-FZ | Rear brake pads FZ-S V3 | rear_brake_pad | set | 450 | FZS_V3* |
| RBP-RE-J | Rear brake pads Classic 350 J (270mm) | rear_brake_pad | set | 700 | C350_J_SIG |

**Wear parts: drivetrain, cables, battery, suspension, mirrors**

| SKU | name | part_type | uom | ₹ | fits |
|---|---|---|---|---|---|
| CSK-SPL | Chain sprocket kit Splendor Plus 428-106L 14/43T | chain_sprocket_kit | kit | 913, alt 600 | SPL_* (supplier_code at S2: Uno Minda CH-5004) |
| CSK-HFD | Chain sprocket kit HF Deluxe | chain_sprocket_kit | kit | 850 | HFD_* |
| CSK-PSN | Chain sprocket kit Passion Pro 420-108L 14/44T | chain_sprocket_kit | kit | 880 | PSN_* (supplier_code at S2: Uno Minda CH-5003) |
| CSK-GLM | Chain sprocket kit Glamour | chain_sprocket_kit | kit | 1050 | GLM_* |
| CSK-SHN | Chain sprocket kit Shine 125 | chain_sprocket_kit | kit | 1100 | SHN_* |
| CSK-P150 | Chain sprocket kit Pulsar 150 | chain_sprocket_kit | kit | 1450 | P150_* |
| CSK-PLT | Chain sprocket kit Platina 100 | chain_sprocket_kit | kit | 850 | PLT_* |
| CSK-APR | Chain sprocket kit Apache RTR 160 | chain_sprocket_kit | kit | 1550 | APR_* |
| CSK-FZ | Chain sprocket kit FZ-S | chain_sprocket_kit | kit | 1650 | FZS_* |
| CSK-XL | Chain sprocket kit XL100 | chain_sprocket_kit | kit | 750 | XL_* |
| CSK-RE-UCE | Chain sprocket kit Classic 350 UCE | chain_sprocket_kit | kit | 2400 | C350_UCE* |
| CSK-RE-J | Chain sprocket kit Classic 350 J | chain_sprocket_kit | kit | 3200 | C350_J* |
| CPL-HERO-97 | Clutch plate set Hero 97cc engine | clutch_plate_set | set | 420, alt 190 | SPL_*, HFD_* (aftermarket supplier_code at S2: LISPART 2CP-1106) |
| CPL-PSN | Clutch plate set Passion Pro | clutch_plate_set | set | 480 | PSN_* |
| CPL-GLM | Clutch plate set Glamour | clutch_plate_set | set | 520 | GLM_* |
| CPL-SHN | Clutch plate set Shine 125 | clutch_plate_set | set | 550 | SHN_* |
| CPL-P150 | Clutch plate set Pulsar 150 | clutch_plate_set | set | 650 | P150_* |
| CPL-PLT | Clutch plate set Platina 100 | clutch_plate_set | set | 450 | PLT_* |
| CPL-APR | Clutch plate set Apache RTR 160 | clutch_plate_set | set | 700 | APR_* |
| CPL-FZ | Clutch plate set FZ-S | clutch_plate_set | set | 750 | FZS_* |
| CPL-RE-UCE | Clutch plate set Classic 350 UCE | clutch_plate_set | set | 1600 | C350_UCE* |
| CPL-RE-J | Clutch plate set Classic 350 J | clutch_plate_set | set | 1900 | C350_J* |
| DBT-ACT110 | Drive belt Activa 110 / Dio | drive_belt | pcs | 850 | ACT_*, DIO_* |
| DBT-A125 | Drive belt Activa 125 | drive_belt | pcs | 950 | A125_* |
| DBT-JUP | Drive belt Jupiter BS4/BS6 | drive_belt | pcs | 900 | JUP_BS4*, JUP_BS6* |
| DBT-JUP-NG | Drive belt Jupiter 113 | drive_belt | pcs | 950 | JUP_NG |
| DBT-NTQ | Drive belt Ntorq 125 | drive_belt | pcs | 1050 | NTQ_* |
| DBT-ACC | Drive belt Access 125 | drive_belt | pcs | 950 | ACC_* |
| CCB-SPL | Clutch cable Splendor Plus | clutch_cable | pcs | 135 | SPL_* |
| CCB-HFD | Clutch cable HF Deluxe | clutch_cable | pcs | 130 | HFD_* |
| CCB-PSN | Clutch cable Passion Pro | clutch_cable | pcs | 150 | PSN_* |
| CCB-GLM | Clutch cable Glamour | clutch_cable | pcs | 160 | GLM_* |
| CCB-SHN | Clutch cable Shine 125 | clutch_cable | pcs | 170 | SHN_* |
| CCB-P150 | Clutch cable Pulsar 150 | clutch_cable | pcs | 190 | P150_* |
| CCB-PLT | Clutch cable Platina 100 | clutch_cable | pcs | 140 | PLT_* |
| CCB-APR | Clutch cable Apache RTR 160 | clutch_cable | pcs | 210 | APR_* |
| CCB-FZ | Clutch cable FZ-S | clutch_cable | pcs | 220 | FZS_* |
| CCB-RE-UCE | Clutch cable Classic 350 UCE | clutch_cable | pcs | 260 | C350_UCE* |
| CCB-RE-J | Clutch cable Classic 350 J | clutch_cable | pcs | 280 | C350_J* |
| BAT-12V-25AH | Battery 12V 2.5Ah (kick start) | battery | pcs | 1100 | SPL_BS4_K, SPL_BS6_K, HFD_BS4_K, HFD_BS6_K, PLT_BS4_K, PLT_BS6_K, XL_BS4_K, XL_BS6_K (supplier_code at S2: Exide 12XL2.5L-C) |
| BAT-12V-4AH | Battery 12V 4Ah (self start) | battery | pcs | 1600 | SPL_BS3, SPL_BS4_S, SPL_BS6_S, SPL_OBD2, HFD_BS4_S, HFD_BS6_S, PSN_*, GLM_*, SHN_*, PLT_BS4_S, PLT_BS6_S, XL_BS4_S, XL_BS6_S, ACT_*, A125_*, DIO_*, JUP_*, ACC_* |
| BAT-12V-5AH | Battery 12V 5Ah | battery | pcs | 1900 | P150_*, APR_*, FZS_*, NTQ_* |
| BAT-RE-350 | Battery 12V Royal Enfield 350 | battery | pcs | 3400 | C350_* |
| RSH-HERO | Rear shock absorber pair Hero commuter | rear_shock | pair | 1600 | SPL_*, HFD_*, PSN_*, GLM_* |
| RSH-HON-SC | Rear shock absorber Honda scooter | rear_shock | pcs | 1800 | ACT_*, A125_*, DIO_* |
| RSH-SHN | Rear shock absorber pair Shine 125 | rear_shock | pair | 1900 | SHN_* |
| RSH-P150 | Rear shock absorber pair Pulsar 150 | rear_shock | pair | 2400 | P150_* |
| RSH-PLT | Rear shock absorber pair Platina 100 | rear_shock | pair | 1500 | PLT_* |
| RSH-TVS-SC | Rear shock absorber Jupiter / Ntorq | rear_shock | pcs | 1700 | JUP_*, NTQ_* |
| RSH-APR | Rear shock absorber pair Apache RTR 160 2V | rear_shock | pair | 2600 | APR_* |
| RSH-XL | Rear shock absorber pair XL100 | rear_shock | pair | 1300 | XL_* |
| RSH-ACC | Rear shock absorber Access 125 | rear_shock | pcs | 1800 | ACC_* |
| RSH-FZ | Rear monoshock FZ-S | rear_shock | pcs | 3000 | FZS_* |
| RSH-RE | Rear shock absorber pair Classic 350 | rear_shock | pair | 3500 | C350_* |
| FSK-HERO | Front fork seal kit Hero commuter | fork_seal_kit | kit | 250 | SPL_*, HFD_*, PSN_*, GLM_* |
| FSK-HON-SC | Front fork seal kit Honda scooter (telescopic) | fork_seal_kit | kit | 320 | ACT_6G*, A125_*, DIO_* |
| FSK-SHN | Front fork seal kit Shine 125 | fork_seal_kit | kit | 300 | SHN_* |
| FSK-P150 | Front fork seal kit Pulsar 150 | fork_seal_kit | kit | 350 | P150_* |
| FSK-PLT | Front fork seal kit Platina 100 | fork_seal_kit | kit | 260 | PLT_* |
| FSK-TVS | Front fork seal kit Jupiter / Ntorq | fork_seal_kit | kit | 300 | JUP_*, NTQ_* |
| FSK-XL | Front fork seal kit XL100 | fork_seal_kit | kit | 220 | XL_* |
| FSK-APR | Front fork seal kit Apache RTR 160 | fork_seal_kit | kit | 380 | APR_* |
| FSK-ACC | Front fork seal kit Access 125 | fork_seal_kit | kit | 320 | ACC_* |
| FSK-FZ | Front fork seal kit FZ-S | fork_seal_kit | kit | 420 | FZS_* |
| FSK-RE-UCE | Front fork seal kit Classic 350 UCE (35mm) | fork_seal_kit | kit | 420 | C350_UCE* |
| FSK-RE-J | Front fork seal kit Classic 350 J (41mm) | fork_seal_kit | kit | 480 | C350_J* |
| MIR-HERO-100 | Mirror set Hero 100cc (pair) | mirror_set | pair | 350 | SPL_*, HFD_* (oem_part_no of the RH mirror: 88110AAEH31S) |
| MIR-HERO-125 | Mirror set Passion / Glamour (pair) | mirror_set | pair | 380 | PSN_*, GLM_* |
| MIR-HON | Mirror set Honda (pair) | mirror_set | pair | 400 | ACT_*, A125_*, DIO_*, SHN_* |
| MIR-BAJ | Mirror set Bajaj (pair) | mirror_set | pair | 380 | P150_*, PLT_* |
| MIR-TVS | Mirror set TVS scooter / XL (pair) | mirror_set | pair | 360 | JUP_*, NTQ_*, XL_* |
| MIR-APR | Mirror set Apache RTR 160 (pair) | mirror_set | pair | 450 | APR_* |
| MIR-SUZ | Mirror set Suzuki Access (pair) | mirror_set | pair | 420 | ACC_* |
| MIR-YAM | Mirror set Yamaha FZ-S (pair) | mirror_set | pair | 480 | FZS_* |
| MIR-RE | Mirror set Royal Enfield Classic (pair) | mirror_set | pair | 650 | C350_* |

Fork seal kits are deliberately missing for ACT_3G, ACT_4G and ACT_5G, which have no telescopic fork. A fork_seal_leaking finding on those bikes stays unresolved, and the manager picks a part or marks "No part needed". The generator never creates that finding on those variants.

**Wear parts: tyres** (spoke wheels take a tube-type tyre sold with its tube as a set; alloy and steel wheels take tubeless)

| SKU | name | part_type | uom | ₹ | fits |
|---|---|---|---|---|---|
| RT-275-18-TT | Rear tyre 2.75-18 tube-type with tube | rear_tyre | set | 1650 | SPL_BS3, HFD_BS4_K, HFD_BS6_K |
| RT-275-18-TL | Rear tyre 2.75-18 tubeless | rear_tyre | pcs | 1550 | SPL_BS4*, SPL_BS6*, SPL_OBD2, HFD_BS4_S, HFD_BS6_S |
| RT-80100-18-TL | Rear tyre 80/100-18 tubeless | rear_tyre | pcs | 1700 | PSN_*, GLM_*, SHN_* |
| RT-300-17-TT | Rear tyre 3.00-17 tube-type with tube | rear_tyre | set | 1600 | PLT_BS4_K |
| RT-300-17-TL | Rear tyre 3.00-17 tubeless | rear_tyre | pcs | 1550 | PLT_BS4_S, PLT_BS6* |
| RT-12080-17-TL | Rear tyre 120/80-17 tubeless | rear_tyre | pcs | 2600 | P150_* |
| RT-11080-17-TL | Rear tyre 110/80-17 tubeless | rear_tyre | pcs | 2400 | APR_* |
| RT-14060-17-TL | Rear tyre 140/60-17 tubeless | rear_tyre | pcs | 3400 | FZS_* |
| RT-12080-18-TT | Rear tyre 120/80-18 tube-type with tube | rear_tyre | set | 3600 | C350_* |
| RT-90100-10-TL | Rear tyre 90/100-10 tubeless | rear_tyre | pcs | 1450 | ACT_*, A125_*, DIO_*, ACC_* |
| RT-9090-12-TL | Rear tyre 90/90-12 tubeless | rear_tyre | pcs | 1600 | JUP_* |
| RT-11080-12-TL | Rear tyre 110/80-12 tubeless | rear_tyre | pcs | 1900 | NTQ_* |
| RT-250-16-TT | Rear tyre 2.50-16 tube-type with tube | rear_tyre | set | 1250 | XL_* |
| FT-275-18-TT | Front tyre 2.75-18 tube-type with tube | front_tyre | set | 1550 | SPL_BS3, HFD_BS4_K, HFD_BS6_K |
| FT-275-18-TL | Front tyre 2.75-18 tubeless | front_tyre | pcs | 1450 | SPL_BS4*, SPL_BS6*, SPL_OBD2, HFD_BS4_S, HFD_BS6_S |
| FT-80100-18-TL | Front tyre 80/100-18 tubeless | front_tyre | pcs | 1600 | PSN_*, GLM_*, SHN_* |
| FT-275-17-TT | Front tyre 2.75-17 tube-type with tube | front_tyre | set | 1450 | PLT_BS4_K |
| FT-275-17-TL | Front tyre 2.75-17 tubeless | front_tyre | pcs | 1400 | PLT_BS4_S, PLT_BS6* |
| FT-9090-17-TL | Front tyre 90/90-17 tubeless | front_tyre | pcs | 1800 | P150_*, APR_* |
| FT-10080-17-TL | Front tyre 100/80-17 tubeless | front_tyre | pcs | 2100 | FZS_* |
| FT-9090-19-TT | Front tyre 90/90-19 tube-type with tube | front_tyre | set | 3000 | C350_* |
| FT-90100-10-TL | Front tyre 90/100-10 tubeless | front_tyre | pcs | 1400 | ACT_3G, ACT_4G, ACT_5G, DIO_* |
| FT-9090-12-TL | Front tyre 90/90-12 tubeless | front_tyre | pcs | 1550 | ACT_6G*, A125_*, JUP_*, ACC_* |
| FT-10080-12-TL | Front tyre 100/80-12 tubeless | front_tyre | pcs | 1800 | NTQ_* |
| FT-250-16-TT | Front tyre 2.50-16 tube-type with tube | front_tyre | set | 1200 | XL_* |

Tyre sizes are typical fitments (est. for the less common models). The point the demo makes is that the wheel type and generation change the part: Activa 5G versus 6G front, and spoke versus alloy on the same Splendor.

### 5.5 Parts generated by rule (category model_specific unless stated)

Price class per model: **C1** = SPL, HFD, PSN, PLT, XL. **C2** = GLM, SHN. **S** = ACT, A125, DIO, JUP, NTQ, ACC. **M** = P150, APR, FZS. **RE** = C350.

| part_type | C1 ₹ | C2 ₹ | S ₹ | M ₹ | RE ₹ |
|---|---|---|---|---|---|
| accelerator_cable (category wear; the fi/ei SKU costs ₹10 more) | 120 | 140 | 160 | 170 | 240 |
| carb_repair_kit (category wear) | 250 | 290 | 310 | 360 | 650 |
| headlamp_assembly | 650 | 800 | 950 | 1400 | 2400 |
| tail_lamp_assembly | 420 | 480 | 650 | 900 | 1300 |
| side_panel_set | 700 | 850 | 1650 | 1200 | 1900 |
| front_mudguard | 380 | 450 | 650 | 700 | 1450 |
| seat_cover | 220 | 250 | 260 | 300 | 550 |
| speedometer | 950 | 1150 | 1200 | 1900 | 2900 |

**Rule A: accelerator cables** (uom pcs). For each model, create one SKU for its carb variants and one for its fi/ei variants, skipping a group the model does not have. Classic 350 gets three: UCE carb (C350_UCE_BS4), UCE FI (C350_UCE_BS6) and J (C350_J*).
- SKU `ACB-<model key>-CARB` or `ACB-<model key>-FI`, plus `ACB-C350-J`.
- Name: "Accelerator cable <model> carb" or "... FI" (FI covers both fi and ei).
- Exception: ACB-SPL-FI fits SPL_BS6* and SPL_OBD2 and has oem_part_no 17910AAEC00S. That number is listed for 2023–25 Splendor Plus; the 2020–23 fitment is an estimate.
- Why this matters: the cable attaches to a carburettor on one and a throttle body on the other, so the same-looking part does not fit across the BS4/BS6 change.

**Rule B: carb repair kits** (uom kit). Create one SKU per model for its carb variants only, as `CRK-<model key>`, named "Carburettor repair kit <model>". FZ-S has none, because every FZ-S variant is FI.

**Rule C: body and electrical parts.** For each body group below, create one SKU for each of the six model_specific part types in the price table.
- SKU: `<TYPE>-<group key>`. TYPE codes: HLA = headlamp_assembly ("Headlamp assembly"), TLA = tail_lamp_assembly ("Tail lamp assembly"), SPS = side_panel_set ("Side panel set", uom set), FMG = front_mudguard ("Front mudguard"), STC = seat_cover ("Seat cover"), SPD = speedometer ("Speedometer"). uom is pcs unless stated.
- Name: "<Part type name> <model> <group label>", e.g. "Side panel set Activa 110 6G".
- Each SKU fits every variant in its group.

| group key | model | label | variants |
|---|---|---|---|
| SPL-G1 | Splendor Plus | BS3/BS4 | SPL_BS3, SPL_BS4* |
| SPL-G2 | Splendor Plus | BS6/OBD2 | SPL_BS6*, SPL_OBD2 |
| HFD-G1 | HF Deluxe | BS4 | HFD_BS4* |
| HFD-G2 | HF Deluxe | BS6 | HFD_BS6* |
| PSN-G1 | Passion Pro | BS4 | PSN_BS4* |
| PSN-G2 | Passion Pro | BS6 | PSN_BS6* |
| GLM-G1 | Glamour | BS4 | GLM_BS4_DR |
| GLM-G2 | Glamour | BS6 | GLM_BS6* |
| ACT-G1 | Activa 110 | 3G/4G | ACT_3G, ACT_4G |
| ACT-G2 | Activa 110 | 5G | ACT_5G |
| ACT-G3 | Activa 110 | 6G | ACT_6G* |
| A125-G1 | Activa 125 | BS4 | A125_BS4* |
| A125-G2 | Activa 125 | BS6 | A125_BS6* |
| SHN-G1 | Shine 125 | BS4 | SHN_BS4* |
| SHN-G2 | Shine 125 | BS6 | SHN_BS6* |
| DIO-G1 | Dio | BS4 | DIO_BS4 |
| DIO-G2 | Dio | BS6 | DIO_BS6 |
| P150-G1 | Pulsar 150 | BS4 | P150_BS4* |
| P150-G2 | Pulsar 150 | BS6 | P150_BS6* |
| PLT-G1 | Platina 100 | BS4 | PLT_BS4* |
| PLT-G2 | Platina 100 | BS6 | PLT_BS6* |
| JUP-G1 | Jupiter | BS4/BS6 | JUP_BS4*, JUP_BS6* |
| JUP-G2 | Jupiter | 113 new gen | JUP_NG |
| APR-G1 | Apache RTR 160 2V | BS4 | APR_BS4* |
| APR-G2 | Apache RTR 160 2V | BS6 | APR_BS6* |
| XL-G1 | XL100 | all | XL_* |
| NTQ-G1 | Ntorq 125 | all | NTQ_* |
| ACC-G1 | Access 125 | BS4 | ACC_BS4* |
| ACC-G2 | Access 125 | BS6 | ACC_BS6* |
| FZS-G1 | FZ-S | V2 | FZS_V2 |
| FZS-G2 | FZ-S | V3 | FZS_V3* |
| C350-G1 | Classic 350 | UCE | C350_UCE* |
| C350-G2 | Classic 350 | J-series | C350_J* |

Exception: SPD-ACT-G1 (Activa 3G/4G speedometer) is the planted unsourced part. It has no preferred supplier, no Jaipur override and no supplier_parts row. The simulator never draws speedometer_not_working on ACT_3G or ACT_4G bikes; only the planted bikes have it: one ACT_3G or ACT_4G bike per workshop with this finding on a confirmed card, so each workshop has the live shortfall SPEC §15 asserts.

### 5.6 Hindi names and shop aliases (applied by part_type to every SKU of that type)

| part_type | name_hi prefix | aliases |
|---|---|---|
| engine_oil | इंजन ऑयल | mobil, oil, engine oil |
| gear_oil | गियर ऑयल | gear oil |
| brake_fluid | ब्रेक ऑयल | brake oil |
| headlamp_bulb | हेडलाइट बल्ब | bulb, light bulb |
| turn_indicator | इंडिकेटर | indicator, winker |
| spark_plug | स्पार्क प्लग | plug, spark |
| air_filter | एयर फ़िल्टर | air filter, filter |
| oil_filter | ऑयल फ़िल्टर | oil filter |
| front_brake_shoe, rear_brake_shoe | ब्रेक शू | break shoe, brake shoe, shoe |
| front_brake_pad, rear_brake_pad | ब्रेक पैड | break pad, disc pad |
| chain_sprocket_kit | चेन सॉकेट किट | chain set, chain kit, socket |
| clutch_plate_set | क्लच प्लेट | clutch plate |
| drive_belt | बेल्ट | belt, v belt |
| clutch_cable | क्लच वायर | clutch wire |
| accelerator_cable | एक्सीलेटर वायर | race wire, accelerator wire |
| carb_repair_kit | कार्बोरेटर किट | carb kit, carburettor |
| battery | बैटरी | battery |
| rear_shock | शॉकर | shocker, shock |
| fork_seal_kit | फोर्क सील | fork seal, oil seal |
| mirror_set | शीशा | mirror, sheesha |
| rear_tyre, front_tyre | टायर | tyre, tire, tayar |
| headlamp_assembly | हेडलाइट | headlight |
| tail_lamp_assembly | टेल लाइट | back light, tail light |
| side_panel_set | साइड पैनल | side cover, panel |
| front_mudguard | मडगार्ड | mudguard, front fender |
| seat_cover | सीट कवर | seat cover |
| speedometer | स्पीडोमीटर | meter, speedo |

name_hi = the prefix plus the rest of the English name, transliterated where it is easy. Leaving the model name in Latin script is fine, e.g. "ब्रेक शू Splendor Plus".

### 5.7 Finding types and mappings

freq is the chance that a simulated bike in an eligible segment or variant has the finding. "mappings" lists the finding_type_parts rows as part_type ×qty [attr=value]. Each finding resolves to one part on any bike (SPEC §3.1). That is why service items that need two parts are separate findings.

| code | label_en | label_hi | area | freq | eligible | mappings |
|---|---|---|---|---|---|---|
| engine_oil_due | Engine oil due | इंजन ऑयल बदलना है | engine | 95% | all | engine_oil ×1 |
| gear_oil_due | Gear oil due | गियर ऑयल बदलना है | engine | 80% | scooter | gear_oil ×1 [segment=scooter] |
| oil_filter_due | Oil filter due | ऑयल फ़िल्टर बदलना है | engine | 90% | P150, APR, FZS, C350 (engines with a filter) | oil_filter ×1 |
| air_filter_dirty | Air filter dirty | एयर फ़िल्टर गंदा | engine | 75% | all | air_filter ×1 |
| spark_plug_worn | Spark plug worn | स्पार्क प्लग खराब | engine | 55% | all | spark_plug ×1 |
| carb_needs_overhaul | Carburettor needs overhaul | कार्बोरेटर ओवरहॉल | engine | 15% | fuel=carb | carb_repair_kit ×1 [fuel=carb] |
| throttle_cable_sticky | Throttle cable sticky | एक्सीलेटर वायर अटकता है | engine | 15% | all | accelerator_cable ×1 |
| front_brake_worn | Front brake worn | आगे का ब्रेक घिसा | brakes | 45% | all | front_brake_shoe ×1 [brake_front=drum]; front_brake_pad ×1 [brake_front=disc] |
| rear_brake_worn | Rear brake worn | पीछे का ब्रेक घिसा | brakes | 50% | all | rear_brake_shoe ×1 [brake_rear=drum]; rear_brake_pad ×1 [brake_rear=disc] |
| brake_fluid_low | Brake fluid low or dark | ब्रेक ऑयल कम | brakes | 30% | brake_front=disc | brake_fluid ×1 [brake_front=disc] |
| chain_sprocket_worn | Chain and sprocket worn | चेन सॉकेट घिसा | drivetrain | 40% | motorcycle, moped | chain_sprocket_kit ×1 [segment=motorcycle]; chain_sprocket_kit ×1 [segment=moped] |
| drive_belt_worn | Drive belt worn | बेल्ट घिसी | drivetrain | 25% | scooter | drive_belt ×1 [segment=scooter] |
| clutch_slipping | Clutch slipping | क्लच फिसल रहा है | drivetrain | 12% | motorcycle | clutch_plate_set ×1 [segment=motorcycle] |
| clutch_cable_frayed | Clutch cable frayed | क्लच वायर खराब | drivetrain | 20% | motorcycle | clutch_cable ×1 [segment=motorcycle] |
| battery_weak | Battery weak | बैटरी कमज़ोर | electrical | 35% | all | battery ×1 |
| headlamp_bulb_fused | Headlamp bulb fused | हेडलाइट बल्ब फ्यूज़ | electrical | 15% | all | headlamp_bulb ×1 |
| headlamp_broken | Headlamp broken | हेडलाइट टूटी | electrical | 5% | all | headlamp_assembly ×1 |
| indicator_broken | Indicator broken | इंडिकेटर टूटा | electrical | 15% | all | turn_indicator ×1 |
| tail_lamp_broken | Tail lamp broken | टेल लाइट टूटी | electrical | 6% | all | tail_lamp_assembly ×1 |
| speedometer_not_working | Speedometer not working | मीटर बंद | electrical | 6% | all | speedometer ×1 |
| mirror_missing_broken | Mirror missing or broken | शीशा टूटा या गायब | body | 30% | all | mirror_set ×1 |
| side_panel_cracked | Side panel cracked | साइड पैनल टूटा | body | 12% (scooter 30%) | all | side_panel_set ×1 |
| front_mudguard_cracked | Front mudguard cracked | आगे का मडगार्ड टूटा | body | 8% | all | front_mudguard ×1 |
| seat_cover_torn | Seat cover torn | सीट कवर फटा | body | 25% | all | seat_cover ×1 |
| rear_tyre_worn | Rear tyre worn | पिछला टायर घिसा | tyres_suspension | 25% | all | rear_tyre ×1 |
| front_tyre_worn | Front tyre worn | अगला टायर घिसा | tyres_suspension | 15% | all | front_tyre ×1 |
| rear_shock_leaking | Rear shock leaking | शॉकर लीक | tyres_suspension | 8% | all | rear_shock ×1 |
| fork_seal_leaking | Front fork seal leaking | फोर्क सील लीक | tyres_suspension | 10% | all except ACT_3G, ACT_4G, ACT_5G | fork_seal_kit ×1 |

- Findings per bike: draw each eligible finding independently with its freq, using the PRNG. If more than 5 are drawn, keep engine_oil_due if present and drop others at random (PRNG) until 5 remain. Random dropping keeps the rare model-specific findings in proportion; dropping by frequency would remove them. If fewer than 2 are drawn, add engine_oil_due and then air_filter_dirty. If the template still exceeds the 60,000-row budget, lower the cap to 4.
- Every variant in §5.2 must resolve every eligible finding to at least one candidate part (Prompt 8 test 7).

### 5.8 Bins

- NCR has 39 normal bins plus NCR-RCV and NCR-QRN:
  - Zone A, consumables: A01-01..A01-04, A02-01..A02-04.
  - Zone B, brakes and cables: B01-01..B01-04, B02-01..B02-04.
  - Zone C, drivetrain, battery and suspension: C01-01..C01-04, C02-01..C02-03.
  - Zone D, electrical and lamps: D01-01..D01-04.
  - Zone E, body and tyres: E01-01..E01-04, E02-01..E02-04, E03-01..E03-04.
- JPR has 13 normal bins plus JPR-RCV and JPR-QRN: A01-01..A01-03, B01-01..B01-03, C01-01..C01-02, D01-01..D01-02, E01-01..E01-03.
- Each part has a home bin in its zone. Assign home bins round-robin in SKU order within the zone.
- The 5 fastest movers per workshop by expected demand (§5.9) also hold stock in a second bin of the same zone. This makes the demo show picking from two bins and the pick list's bin order.
- Zone mapping by part_type:
  - A: engine_oil, gear_oil, brake_fluid, spark_plug, air_filter, oil_filter.
  - B: brake shoes, brake pads, cables.
  - C: chain_sprocket_kit, clutch_plate_set, drive_belt, battery, rear_shock, fork_seal_kit, carb_repair_kit.
  - D: headlamp_bulb, turn_indicator, headlamp_assembly, tail_lamp_assembly, speedometer.
  - E: everything else.

### 5.9 Reorder settings and opening stock

- Expected daily demand per (workshop, part):
  - Run the SPEC §9.1 auto-pick for every variant and every eligible finding.
  - Multiply by the bikes/day, the model mix, the variant weight, the finding frequency and the qty.
  - Compute it in the generator; do not store it.
- Every (workshop, part) gets a reorder_settings row.
  - auto = true when expected demand ≥ 0.2/day, the part's category is consumable or wear (model_specific parts are always on-demand, SPEC §7.1) and the part is not aftermarket. The settings are then safety_stock = ceil(demand × 2) and max_qty = max(safety_stock + 2, ceil(demand × 12)).
  - Otherwise auto = false, safety_stock = 0, max_qty = 1.
  - Jaipur's lower volume automatically makes fewer of its parts auto.
- Opening stock (adjust_in, reason 'opening_balance', at anchor−180) goes into home bins:
  - Every auto part: max_qty.
  - Aftermarket SKUs: none. They exist as cheaper alternatives the manager can switch to, with supplier prices.
  - Every other part (model_specific parts, and consumable or wear parts with auto = false): none, except the planted dead stock below (the CRK-* kits there are wear parts). They are bought on demand, which is exactly why bikes wait for them.
- Planted dead stock. Opening stock only:
  - NCR, 10 SKUs, 1–4 units each: SPS-ACT-G1, FMG-ACT-G1, CRK-C350, HLA-FZS-G1, TLA-FZS-G1, SPS-P150-G1, HLA-GLM-G1, STC-PSN-G1, SPD-HFD-G1, CRK-APR.
  - JPR, 8 SKUs: HLA-APR-G1, SPS-NTQ-G1, FMG-ACC-G1, STC-JUP-G2, CRK-NTQ, SPS-DIO-G1, TLA-PLT-G1, HLA-A125-G1.
  - These are real dead-stock patterns: body parts for old generations bought "just in case", and carb kits for models that have moved to FI.
  - To keep them dead, the simulator never draws the finding that would consume one of these SKUs on bikes of that SKU's variants. For example, there is no side_panel_cracked on ACT_3G/ACT_4G bikes at NCR and no carb_needs_overhaul on C350_UCE_BS4 bikes at NCR.
  - Nothing else should end up dead. Auto parts move, and on-demand parts are ordered only for a real shortfall. If the dead-stock count at reset is outside 8–12, report which SKUs caused it instead of loosening the check.
- Planted flagged fitment (NCR): a learned fitment of AF-JUP (the BS4 filter) on JUP_BS6_DI with confirmed_count 1 and flagged_count 3. Seed it through real history so the counters match what the RPCs would produce:
  - One closed card where a manager switched the line to AF-JUP and it was issued. The close creates the learned row with confirmed_count 1.
  - Three later cards where AF-JUP was issued and then returned as wrong_fitment with the note "Airbox clip does not match BS6 housing". Each return flags the fitment once. On the first two cards the manager then added an AF-JUP-BS6 line, issued it, and closed the card. The third card stays confirmed with its bike in_repair, needs_review_reason still set by that return and no AF-JUP-BS6 line yet: it is the flagged-fitment cause on the NCR blocked board (SPEC §15).
  - Result: auto-pick skips AF-JUP on that variant (flagged > confirmed) and uses AF-JUP-BS6. A manual pick shows the red badge with that note.

### 5.10 Interchangeability facts (for the write-up and the demo script; the data above already encodes them)

- One Hero brake shoe kit (Hero Genuine K06451KCCA900S, about ₹220) is listed for 24 Hero models, including Splendor Plus, Passion Pro, Glamour and HF Deluxe. One SKU serves most Hero drum bikes.
- Hero air filter 17208AABA00S (₹155) is listed for Splendor Plus, Super Splendor, Passion Pro and Glamour.
- Hero RH mirror 88110AAEH31S (₹175) fits Splendor Plus from 2012 through BS6 and also HF Deluxe. Cosmetic parts carried over the BS4 to BS6 change.
- Looks the same but differs: the Uno Minda chain kit CH-5004 (428 pitch, 106 links, 14/43T, ₹822) fits Splendor Plus. CH-5003 (420 pitch, 108 links, 14/44T) fits Passion Pro. Both are "Hero 100cc" kits, and neither fits the other bike.
- Looks the same but differs by year: the Splendor Plus accelerator cable 17910KWH760S fits only carb bikes, while 17910AAEC00S fits 2023+ FI bikes.
- Differs by generation: the Activa 5G (10-inch front, non-telescopic) and 6G (12-inch front, telescopic) need a different front tyre, fork and front panels.
- Differs by variant in the same year: Pulsar 150 Standard and Twin Disc need different front pads and only the Twin Disc needs rear pads. The same is true of Classic 350 Redditch (rear drum) and Signals (rear disc).
- Aftermarket parts typically cost 30–40% less than OEM, e.g. the Hero 97cc clutch plates at ₹420 OEM vs ₹189 aftermarket (LISPART 2CP-1106). Emergency buys at a local counter typically cost 15–40% more than the usual price.
- Market context: India's used two-wheeler market was about 31.8 million units in 2023 (Autocar Pro). Vutto raised a $7M Series A in August 2025 (YourStory).

---
