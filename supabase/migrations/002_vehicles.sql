-- ============================================================
-- VERVIERS DÉPANNAGE — Marques et modèles véhicules
-- Migration 002 — Base européenne complète
-- ============================================================

-- Vider les tables existantes
TRUNCATE public.vehicle_models CASCADE;
TRUNCATE public.vehicle_brands CASCADE;

-- ============================================================
-- MARQUES
-- ============================================================
INSERT INTO public.vehicle_brands (name, country) VALUES
('Abarth', 'IT'),
('Alfa Romeo', 'IT'),
('Aston Martin', 'GB'),
('Audi', 'DE'),
('Bentley', 'GB'),
('BMW', 'DE'),
('Bugatti', 'FR'),
('Cadillac', 'US'),
('Chevrolet', 'US'),
('Chrysler', 'US'),
('Citroën', 'FR'),
('Cupra', 'ES'),
('Dacia', 'RO'),
('Daewoo', 'KR'),
('Daihatsu', 'JP'),
('Dodge', 'US'),
('DS Automobiles', 'FR'),
('Ferrari', 'IT'),
('Fiat', 'IT'),
('Ford', 'US'),
('Genesis', 'KR'),
('Honda', 'JP'),
('Hummer', 'US'),
('Hyundai', 'KR'),
('Infiniti', 'JP'),
('Isuzu', 'JP'),
('Jaguar', 'GB'),
('Jeep', 'US'),
('Kia', 'KR'),
('Lamborghini', 'IT'),
('Lancia', 'IT'),
('Land Rover', 'GB'),
('Lexus', 'JP'),
('Lotus', 'GB'),
('Maserati', 'IT'),
('Mazda', 'JP'),
('McLaren', 'GB'),
('Mercedes-Benz', 'DE'),
('MG', 'CN'),
('Mini', 'GB'),
('Mitsubishi', 'JP'),
('Nissan', 'JP'),
('Opel', 'DE'),
('Peugeot', 'FR'),
('Porsche', 'DE'),
('Renault', 'FR'),
('Rolls-Royce', 'GB'),
('Saab', 'SE'),
('Seat', 'ES'),
('Skoda', 'CZ'),
('Smart', 'DE'),
('Ssangyong', 'KR'),
('Subaru', 'JP'),
('Suzuki', 'JP'),
('Tesla', 'US'),
('Toyota', 'JP'),
('Volkswagen', 'DE'),
('Volvo', 'SE'),
('Autre', NULL);

-- ============================================================
-- MODÈLES PAR MARQUE
-- ============================================================

-- Abarth
INSERT INTO public.vehicle_models (brand_id, name, category) SELECT id, m, 'berline' FROM vehicle_brands WHERE name='Abarth', unnest(ARRAY['500','595','695','124 Spider','Autre']) m;

-- Alfa Romeo
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Giulia','berline'),('Giulietta','berline'),('Stelvio','suv'),
  ('Tonale','suv'),('4C','berline'),('MiTo','berline'),
  ('Spider','cabriolet'),('156','berline'),('159','berline'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Alfa Romeo';

-- Audi
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('A1','berline'),('A3','berline'),('A4','berline'),('A5','berline'),
  ('A6','berline'),('A7','berline'),('A8','berline'),
  ('Q2','suv'),('Q3','suv'),('Q4 e-tron','suv'),('Q5','suv'),('Q7','suv'),('Q8','suv'),
  ('TT','cabriolet'),('R8','berline'),('e-tron','suv'),('e-tron GT','berline'),
  ('RS3','berline'),('RS4','break'),('RS5','berline'),('RS6','break'),('RS7','berline'),
  ('S3','berline'),('S4','berline'),('S5','berline'),('S6','berline'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Audi';

-- BMW
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Série 1','berline'),('Série 2','berline'),('Série 3','berline'),
  ('Série 4','berline'),('Série 5','berline'),('Série 6','berline'),
  ('Série 7','berline'),('Série 8','berline'),
  ('X1','suv'),('X2','suv'),('X3','suv'),('X4','suv'),('X5','suv'),('X6','suv'),('X7','suv'),
  ('Z3','cabriolet'),('Z4','cabriolet'),
  ('i3','berline'),('i4','berline'),('i5','berline'),('i7','berline'),('iX','suv'),('iX3','suv'),
  ('M2','berline'),('M3','berline'),('M4','berline'),('M5','berline'),('M8','berline'),
  ('Autre','autre')
) AS m(name,cat) WHERE b.name='BMW';

-- Citroën
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('C1','berline'),('C3','berline'),('C3 Aircross','suv'),('C4','berline'),
  ('C4 Cactus','suv'),('C4 Picasso','monospace'),('C5','berline'),
  ('C5 Aircross','suv'),('C5 X','berline'),('C-Elysée','berline'),
  ('Berlingo','utilitaire'),('Jumpy','utilitaire'),('Jumper','utilitaire'),
  ('SpaceTourer','monospace'),('ë-C4','berline'),('ë-Berlingo','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Citroën';

-- Cupra
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Ateca','suv'),('Formentor','suv'),('Born','berline'),('Leon','berline'),('Terramar','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Cupra';

-- Dacia
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Sandero','berline'),('Logan','berline'),('Duster','suv'),('Jogger','monospace'),
  ('Spring','berline'),('Bigster','suv'),('Lodgy','monospace'),('Dokker','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Dacia';

-- DS Automobiles
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('DS 3','berline'),('DS 4','berline'),('DS 7','suv'),('DS 9','berline'),('Autre','autre')
) AS m(name,cat) WHERE b.name='DS Automobiles';

-- Fiat
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('500','berline'),('500X','suv'),('500L','monospace'),('500e','berline'),
  ('Panda','berline'),('Tipo','berline'),('Bravo','berline'),
  ('Doblo','utilitaire'),('Ducato','utilitaire'),('Scudo','utilitaire'),
  ('Punto','berline'),('Stilo','berline'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Fiat';

-- Ford
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Fiesta','berline'),('Focus','berline'),('Mondeo','berline'),
  ('Mustang','berline'),('Mustang Mach-E','suv'),
  ('Puma','suv'),('Kuga','suv'),('EcoSport','suv'),('Explorer','suv'),('Edge','suv'),
  ('Galaxy','monospace'),('S-Max','monospace'),('C-Max','monospace'),
  ('Transit','utilitaire'),('Transit Connect','utilitaire'),('Transit Custom','utilitaire'),
  ('Ranger','utilitaire'),('F-150','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Ford';

-- Honda
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Civic','berline'),('Jazz','berline'),('HR-V','suv'),('CR-V','suv'),
  ('ZR-V','suv'),('e:NY1','suv'),('e','berline'),('Legend','berline'),
  ('Accord','berline'),('FR-V','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Honda';

-- Hyundai
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('i10','berline'),('i20','berline'),('i30','berline'),('i40','berline'),
  ('IONIQ','berline'),('IONIQ 5','suv'),('IONIQ 6','berline'),
  ('Kona','suv'),('Tucson','suv'),('Santa Fe','suv'),('Nexo','suv'),
  ('H-1','utilitaire'),('Staria','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Hyundai';

-- Jaguar
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('XE','berline'),('XF','berline'),('XJ','berline'),('F-Type','cabriolet'),
  ('E-Pace','suv'),('F-Pace','suv'),('I-Pace','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Jaguar';

-- Jeep
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Renegade','suv'),('Compass','suv'),('Cherokee','suv'),('Grand Cherokee','suv'),
  ('Wrangler','suv'),('Avenger','suv'),('Commander','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Jeep';

-- Kia
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Picanto','berline'),('Rio','berline'),('Ceed','berline'),('ProCeed','berline'),
  ('Stinger','berline'),('EV6','berline'),('EV9','suv'),
  ('Stonic','suv'),('Niro','suv'),('Sportage','suv'),('Sorento','suv'),
  ('Carnival','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Kia';

-- Land Rover
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Defender','suv'),('Discovery','suv'),('Discovery Sport','suv'),
  ('Freelander','suv'),('Range Rover','suv'),('Range Rover Evoque','suv'),
  ('Range Rover Sport','suv'),('Range Rover Velar','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Land Rover';

-- Lexus
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('CT','berline'),('IS','berline'),('ES','berline'),('GS','berline'),('LS','berline'),
  ('UX','suv'),('NX','suv'),('RX','suv'),('GX','suv'),('LX','suv'),
  ('LC','cabriolet'),('RC','berline'),('RZ','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Lexus';

-- Mazda
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Mazda2','berline'),('Mazda3','berline'),('Mazda6','berline'),
  ('MX-5','cabriolet'),('MX-30','suv'),
  ('CX-3','suv'),('CX-30','suv'),('CX-5','suv'),('CX-60','suv'),('CX-80','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Mazda';

-- Mercedes-Benz
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Classe A','berline'),('Classe B','berline'),('Classe C','berline'),
  ('Classe E','berline'),('Classe S','berline'),('Classe G','suv'),
  ('CLA','berline'),('CLS','berline'),('GLA','suv'),('GLB','suv'),('GLC','suv'),
  ('GLE','suv'),('GLS','suv'),('EQA','suv'),('EQB','suv'),('EQC','suv'),
  ('EQE','berline'),('EQS','berline'),('SL','cabriolet'),('SLC','cabriolet'),
  ('AMG GT','berline'),('Vito','utilitaire'),('Sprinter','utilitaire'),
  ('Citan','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Mercedes-Benz';

-- MG
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('MG3','berline'),('MG4','berline'),('MG5','break'),('MG ZS','suv'),('MG HS','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='MG';

-- Mini
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Mini 3 portes','berline'),('Mini 5 portes','berline'),('Mini Cabrio','cabriolet'),
  ('Mini Clubman','break'),('Mini Countryman','suv'),('Mini Paceman','suv'),
  ('Mini Electric','berline'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Mini';

-- Mitsubishi
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Colt','berline'),('Space Star','berline'),('Eclipse Cross','suv'),
  ('ASX','suv'),('Outlander','suv'),('L200','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Mitsubishi';

-- Nissan
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Micra','berline'),('Juke','suv'),('Qashqai','suv'),('X-Trail','suv'),
  ('Ariya','suv'),('Leaf','berline'),('Note','berline'),('Pulsar','berline'),
  ('Navara','utilitaire'),('NV200','utilitaire'),('NV300','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Nissan';

-- Opel
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Adam','berline'),('Agila','berline'),('Astra','berline'),('Cascada','cabriolet'),
  ('Corsa','berline'),('Grandland','suv'),('Insignia','berline'),
  ('Meriva','monospace'),('Mokka','suv'),('Omega','berline'),('Signum','berline'),
  ('Vectra','berline'),('Vivaro','utilitaire'),('Movano','utilitaire'),
  ('Combo','utilitaire'),('Zafira','monospace'),('Crossland','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Opel';

-- Peugeot
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('108','berline'),('208','berline'),('308','berline'),('408','berline'),
  ('508','berline'),('2008','suv'),('3008','suv'),('5008','suv'),
  ('e-208','berline'),('e-2008','suv'),('e-308','berline'),
  ('Partner','utilitaire'),('Expert','utilitaire'),('Boxer','utilitaire'),
  ('Rifter','monospace'),('Traveller','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Peugeot';

-- Porsche
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('911','berline'),('Boxster','cabriolet'),('Cayman','berline'),
  ('Cayenne','suv'),('Macan','suv'),('Panamera','berline'),
  ('Taycan','berline'),('Taycan Cross Turismo','break'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Porsche';

-- Renault
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Twingo','berline'),('Clio','berline'),('Megane','berline'),('Laguna','berline'),
  ('Talisman','berline'),('Zoe','berline'),('Megane E-Tech','berline'),
  ('Captur','suv'),('Kadjar','suv'),('Austral','suv'),('Arkana','suv'),('Koleos','suv'),
  ('Scenic','monospace'),('Espace','monospace'),('Kangoo','utilitaire'),
  ('Trafic','utilitaire'),('Master','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Renault';

-- Seat
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Ibiza','berline'),('Leon','berline'),('Arona','suv'),('Ateca','suv'),
  ('Tarraco','suv'),('Mii','berline'),('Alhambra','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Seat';

-- Skoda
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Citigo','berline'),('Fabia','berline'),('Rapid','berline'),('Scala','berline'),
  ('Octavia','berline'),('Superb','berline'),
  ('Kamiq','suv'),('Karoq','suv'),('Kodiaq','suv'),('Enyaq','suv'),
  ('Roomster','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Skoda';

-- Smart
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Fortwo','berline'),('Forfour','berline'),('#1','suv'),('#3','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Smart';

-- Subaru
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Impreza','berline'),('Legacy','berline'),('Outback','break'),
  ('Forester','suv'),('XV','suv'),('BRZ','berline'),('Solterra','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Subaru';

-- Suzuki
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Alto','berline'),('Celerio','berline'),('Swift','berline'),('Baleno','berline'),
  ('Ignis','suv'),('S-Cross','suv'),('Vitara','suv'),('Jimny','suv'),
  ('SX4','suv'),('Swace','break'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Suzuki';

-- Tesla
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Model 3','berline'),('Model S','berline'),('Model X','suv'),
  ('Model Y','suv'),('Cybertruck','utilitaire'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Tesla';

-- Toyota
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Aygo','berline'),('Yaris','berline'),('Corolla','berline'),('Camry','berline'),
  ('GR86','berline'),('Supra','berline'),('C-HR','suv'),('RAV4','suv'),
  ('Yaris Cross','suv'),('Corolla Cross','suv'),('Highlander','suv'),('Land Cruiser','suv'),
  ('Prius','berline'),('bZ4X','suv'),('Proace','utilitaire'),('Hilux','utilitaire'),
  ('Verso','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Toyota';

-- Volkswagen
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('Polo','berline'),('Golf','berline'),('Passat','berline'),('Arteon','berline'),
  ('Phaeton','berline'),('Up!','berline'),('Jetta','berline'),
  ('T-Cross','suv'),('T-Roc','suv'),('Tiguan','suv'),('Touareg','suv'),
  ('ID.3','berline'),('ID.4','suv'),('ID.5','suv'),('ID.7','berline'),
  ('Caddy','utilitaire'),('Transporter','utilitaire'),('Crafter','utilitaire'),
  ('Sharan','monospace'),('Touran','monospace'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Volkswagen';

-- Volvo
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT b.id, m.name, m.cat FROM vehicle_brands b, (VALUES
  ('C30','berline'),('C40','suv'),('S40','berline'),('S60','berline'),
  ('S80','berline'),('S90','berline'),('V40','break'),('V60','break'),
  ('V70','break'),('V90','break'),('XC40','suv'),('XC60','suv'),('XC90','suv'),
  ('EX30','suv'),('EX90','suv'),('Autre','autre')
) AS m(name,cat) WHERE b.name='Volvo';

-- Autre (marque non listée)
INSERT INTO public.vehicle_models (brand_id, name, category)
SELECT id, 'Autre', 'autre' FROM vehicle_brands WHERE name='Autre';
