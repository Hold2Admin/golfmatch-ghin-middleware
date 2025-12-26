-- Seed California courses for GHIN Mock Database

-- Torrey Pines South Course (San Diego, CA)
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) VALUES
('GHIN-87654', 'Torrey Pines South Course', 'San Diego', 'CA', 'USA', 'GHIN-FAC-6543');

INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage) VALUES
('GHIN-TEE-4001', 'GHIN-87654', 'Black', 'M', 1, 75.3, 144, 71, 7588),
('GHIN-TEE-4002', 'GHIN-87654', 'Black', 'W', 1, 74.1, 138, 71, 6555),
('GHIN-TEE-4003', 'GHIN-87654', 'Gold', 'M', 0, 72.5, 139, 71, 7025);

-- Black M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-4001', 1, 4, 13, 420), ('GHIN-TEE-4001', 2, 4, 5, 495), ('GHIN-TEE-4001', 3, 4, 11, 385),
('GHIN-TEE-4001', 4, 5, 7, 595), ('GHIN-TEE-4001', 5, 3, 17, 215), ('GHIN-TEE-4001', 6, 4, 3, 425),
('GHIN-TEE-4001', 7, 4, 9, 415), ('GHIN-TEE-4001', 8, 4, 1, 505), ('GHIN-TEE-4001', 9, 3, 15, 195),
('GHIN-TEE-4001', 10, 5, 6, 620), ('GHIN-TEE-4001', 11, 4, 12, 445), ('GHIN-TEE-4001', 12, 4, 14, 460),
('GHIN-TEE-4001', 13, 4, 2, 445), ('GHIN-TEE-4001', 14, 4, 10, 445), ('GHIN-TEE-4001', 15, 3, 16, 210),
('GHIN-TEE-4001', 16, 4, 4, 535), ('GHIN-TEE-4001', 17, 3, 18, 205), ('GHIN-TEE-4001', 18, 4, 8, 450);

-- Black W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-4002', 1, 4, 13, 365), ('GHIN-TEE-4002', 2, 4, 5, 430), ('GHIN-TEE-4002', 3, 4, 11, 335),
('GHIN-TEE-4002', 4, 5, 3, 510), ('GHIN-TEE-4002', 5, 3, 17, 175), ('GHIN-TEE-4002', 6, 4, 7, 370),
('GHIN-TEE-4002', 7, 4, 9, 360), ('GHIN-TEE-4002', 8, 4, 1, 440), ('GHIN-TEE-4002', 9, 3, 15, 160),
('GHIN-TEE-4002', 10, 5, 2, 535), ('GHIN-TEE-4002', 11, 4, 12, 385), ('GHIN-TEE-4002', 12, 4, 14, 395),
('GHIN-TEE-4002', 13, 4, 6, 390), ('GHIN-TEE-4002', 14, 4, 10, 385), ('GHIN-TEE-4002', 15, 3, 16, 170),
('GHIN-TEE-4002', 16, 4, 4, 465), ('GHIN-TEE-4002', 17, 3, 18, 165), ('GHIN-TEE-4002', 18, 4, 8, 390);

-- Gold M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-4003', 1, 4, 13, 390), ('GHIN-TEE-4003', 2, 4, 5, 460), ('GHIN-TEE-4003', 3, 4, 11, 355),
('GHIN-TEE-4003', 4, 5, 7, 555), ('GHIN-TEE-4003', 5, 3, 17, 195), ('GHIN-TEE-4003', 6, 4, 3, 395),
('GHIN-TEE-4003', 7, 4, 9, 385), ('GHIN-TEE-4003', 8, 4, 1, 470), ('GHIN-TEE-4003', 9, 3, 15, 175),
('GHIN-TEE-4003', 10, 5, 6, 580), ('GHIN-TEE-4003', 11, 4, 12, 415), ('GHIN-TEE-4003', 12, 4, 14, 425),
('GHIN-TEE-4003', 13, 4, 2, 415), ('GHIN-TEE-4003', 14, 4, 10, 415), ('GHIN-TEE-4003', 15, 3, 16, 190),
('GHIN-TEE-4003', 16, 4, 4, 500), ('GHIN-TEE-4003', 17, 3, 18, 185), ('GHIN-TEE-4003', 18, 4, 8, 420);

-- Olympic Club Lake Course (San Francisco, CA)
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) VALUES
('GHIN-98765', 'Olympic Club Lake Course', 'San Francisco', 'CA', 'USA', 'GHIN-FAC-5432');

INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage) VALUES
('GHIN-TEE-5001', 'GHIN-98765', 'Tournament', 'M', 1, 76.0, 155, 72, 7256),
('GHIN-TEE-5002', 'GHIN-98765', 'Tournament', 'W', 1, 73.2, 145, 72, 6365),
('GHIN-TEE-5003', 'GHIN-98765', 'Players', 'M', 0, 73.8, 150, 72, 6778),
('GHIN-TEE-5004', 'GHIN-98765', 'Member', 'W', 0, 70.5, 140, 72, 5845);

-- Tournament M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-5001', 1, 4, 11, 423), ('GHIN-TEE-5001', 2, 5, 7, 532), ('GHIN-TEE-5001', 3, 3, 15, 177),
('GHIN-TEE-5001', 4, 4, 3, 384), ('GHIN-TEE-5001', 5, 4, 9, 471), ('GHIN-TEE-5001', 6, 4, 13, 393),
('GHIN-TEE-5001', 7, 4, 5, 442), ('GHIN-TEE-5001', 8, 3, 17, 237), ('GHIN-TEE-5001', 9, 5, 1, 583),
('GHIN-TEE-5001', 10, 4, 6, 424), ('GHIN-TEE-5001', 11, 5, 2, 558), ('GHIN-TEE-5001', 12, 4, 14, 358),
('GHIN-TEE-5001', 13, 3, 18, 181), ('GHIN-TEE-5001', 14, 4, 10, 467), ('GHIN-TEE-5001', 15, 4, 12, 449),
('GHIN-TEE-5001', 16, 5, 4, 507), ('GHIN-TEE-5001', 17, 3, 16, 137), ('GHIN-TEE-5001', 18, 4, 8, 462);

-- Tournament W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-5002', 1, 4, 11, 370), ('GHIN-TEE-5002', 2, 5, 3, 465), ('GHIN-TEE-5002', 3, 3, 15, 145),
('GHIN-TEE-5002', 4, 4, 7, 335), ('GHIN-TEE-5002', 5, 4, 1, 410), ('GHIN-TEE-5002', 6, 4, 13, 340),
('GHIN-TEE-5002', 7, 4, 5, 385), ('GHIN-TEE-5002', 8, 3, 17, 190), ('GHIN-TEE-5002', 9, 5, 9, 505),
('GHIN-TEE-5002', 10, 4, 6, 370), ('GHIN-TEE-5002', 11, 5, 2, 485), ('GHIN-TEE-5002', 12, 4, 14, 310),
('GHIN-TEE-5002', 13, 3, 18, 150), ('GHIN-TEE-5002', 14, 4, 10, 405), ('GHIN-TEE-5002', 15, 4, 12, 390),
('GHIN-TEE-5002', 16, 5, 4, 440), ('GHIN-TEE-5002', 17, 3, 16, 115), ('GHIN-TEE-5002', 18, 4, 8, 400);

-- Players M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-5003', 1, 4, 11, 395), ('GHIN-TEE-5003', 2, 5, 7, 495), ('GHIN-TEE-5003', 3, 3, 15, 160),
('GHIN-TEE-5003', 4, 4, 3, 360), ('GHIN-TEE-5003', 5, 4, 9, 440), ('GHIN-TEE-5003', 6, 4, 13, 365),
('GHIN-TEE-5003', 7, 4, 5, 415), ('GHIN-TEE-5003', 8, 3, 17, 215), ('GHIN-TEE-5003', 9, 5, 1, 545),
('GHIN-TEE-5003', 10, 4, 6, 395), ('GHIN-TEE-5003', 11, 5, 2, 520), ('GHIN-TEE-5003', 12, 4, 14, 335),
('GHIN-TEE-5003', 13, 3, 18, 165), ('GHIN-TEE-5003', 14, 4, 10, 435), ('GHIN-TEE-5003', 15, 4, 12, 420),
('GHIN-TEE-5003', 16, 5, 4, 475), ('GHIN-TEE-5003', 17, 3, 16, 125), ('GHIN-TEE-5003', 18, 4, 8, 430);

-- Member W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-5004', 1, 4, 11, 340), ('GHIN-TEE-5004', 2, 5, 3, 430), ('GHIN-TEE-5004', 3, 3, 15, 130),
('GHIN-TEE-5004', 4, 4, 7, 310), ('GHIN-TEE-5004', 5, 4, 1, 380), ('GHIN-TEE-5004', 6, 4, 13, 315),
('GHIN-TEE-5004', 7, 4, 5, 355), ('GHIN-TEE-5004', 8, 3, 17, 170), ('GHIN-TEE-5004', 9, 5, 9, 470),
('GHIN-TEE-5004', 10, 4, 6, 345), ('GHIN-TEE-5004', 11, 5, 2, 450), ('GHIN-TEE-5004', 12, 4, 14, 285),
('GHIN-TEE-5004', 13, 3, 18, 135), ('GHIN-TEE-5004', 14, 4, 10, 375), ('GHIN-TEE-5004', 15, 4, 12, 360),
('GHIN-TEE-5004', 16, 5, 4, 410), ('GHIN-TEE-5004', 17, 3, 16, 105), ('GHIN-TEE-5004', 18, 4, 8, 370);

-- Riviera Country Club (Pacific Palisades, CA)
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) VALUES
('GHIN-13579', 'Riviera Country Club', 'Pacific Palisades', 'CA', 'USA', 'GHIN-FAC-4321');

INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage) VALUES
('GHIN-TEE-6001', 'GHIN-13579', 'Championship', 'M', 1, 77.5, 155, 71, 7468),
('GHIN-TEE-6002', 'GHIN-13579', 'Championship', 'W', 1, 75.8, 148, 71, 6684),
('GHIN-TEE-6003', 'GHIN-13579', 'Blue', 'M', 0, 74.2, 148, 71, 6889),
('GHIN-TEE-6004', 'GHIN-13579', 'White', 'M', 0, 71.5, 143, 71, 6345);

-- Championship M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-6001', 1, 4, 7, 430), ('GHIN-TEE-6001', 2, 4, 15, 389), ('GHIN-TEE-6001', 3, 3, 17, 210),
('GHIN-TEE-6001', 4, 5, 1, 517), ('GHIN-TEE-6001', 5, 4, 5, 478), ('GHIN-TEE-6001', 6, 4, 11, 408),
('GHIN-TEE-6001', 7, 5, 3, 525), ('GHIN-TEE-6001', 8, 3, 13, 203), ('GHIN-TEE-6001', 9, 4, 9, 431),
('GHIN-TEE-6001', 10, 4, 2, 502), ('GHIN-TEE-6001', 11, 4, 12, 435), ('GHIN-TEE-6001', 12, 5, 4, 499),
('GHIN-TEE-6001', 13, 3, 16, 160), ('GHIN-TEE-6001', 14, 4, 10, 517), ('GHIN-TEE-6001', 15, 4, 6, 459),
('GHIN-TEE-6001', 16, 4, 8, 490), ('GHIN-TEE-6001', 17, 3, 18, 207), ('GHIN-TEE-6001', 18, 4, 14, 411);

-- Championship W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-6002', 1, 4, 7, 385), ('GHIN-TEE-6002', 2, 4, 15, 345), ('GHIN-TEE-6002', 3, 3, 17, 175),
('GHIN-TEE-6002', 4, 5, 1, 460), ('GHIN-TEE-6002', 5, 4, 3, 425), ('GHIN-TEE-6002', 6, 4, 11, 365),
('GHIN-TEE-6002', 7, 5, 5, 470), ('GHIN-TEE-6002', 8, 3, 13, 170), ('GHIN-TEE-6002', 9, 4, 9, 385),
('GHIN-TEE-6002', 10, 4, 2, 445), ('GHIN-TEE-6002', 11, 4, 12, 390), ('GHIN-TEE-6002', 12, 5, 4, 445),
('GHIN-TEE-6002', 13, 3, 16, 135), ('GHIN-TEE-6002', 14, 4, 10, 460), ('GHIN-TEE-6002', 15, 4, 6, 410),
('GHIN-TEE-6002', 16, 4, 8, 435), ('GHIN-TEE-6002', 17, 3, 18, 175), ('GHIN-TEE-6002', 18, 4, 14, 365);

-- Blue M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-6003', 1, 4, 7, 400), ('GHIN-TEE-6003', 2, 4, 15, 360), ('GHIN-TEE-6003', 3, 3, 17, 190),
('GHIN-TEE-6003', 4, 5, 1, 485), ('GHIN-TEE-6003', 5, 4, 5, 445), ('GHIN-TEE-6003', 6, 4, 11, 380),
('GHIN-TEE-6003', 7, 5, 3, 495), ('GHIN-TEE-6003', 8, 3, 13, 185), ('GHIN-TEE-6003', 9, 4, 9, 405),
('GHIN-TEE-6003', 10, 4, 2, 470), ('GHIN-TEE-6003', 11, 4, 12, 405), ('GHIN-TEE-6003', 12, 5, 4, 470),
('GHIN-TEE-6003', 13, 3, 16, 145), ('GHIN-TEE-6003', 14, 4, 10, 485), ('GHIN-TEE-6003', 15, 4, 6, 430),
('GHIN-TEE-6003', 16, 4, 8, 460), ('GHIN-TEE-6003', 17, 3, 18, 190), ('GHIN-TEE-6003', 18, 4, 14, 385);

-- White M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-6004', 1, 4, 7, 370), ('GHIN-TEE-6004', 2, 4, 15, 335), ('GHIN-TEE-6004', 3, 3, 17, 170),
('GHIN-TEE-6004', 4, 5, 1, 455), ('GHIN-TEE-6004', 5, 4, 5, 415), ('GHIN-TEE-6004', 6, 4, 11, 350),
('GHIN-TEE-6004', 7, 5, 3, 465), ('GHIN-TEE-6004', 8, 3, 13, 165), ('GHIN-TEE-6004', 9, 4, 9, 375),
('GHIN-TEE-6004', 10, 4, 2, 440), ('GHIN-TEE-6004', 11, 4, 12, 375), ('GHIN-TEE-6004', 12, 5, 4, 440),
('GHIN-TEE-6004', 13, 3, 16, 130), ('GHIN-TEE-6004', 14, 4, 10, 455), ('GHIN-TEE-6004', 15, 4, 6, 400),
('GHIN-TEE-6004', 16, 4, 8, 430), ('GHIN-TEE-6004', 17, 3, 18, 170), ('GHIN-TEE-6004', 18, 4, 14, 360);
