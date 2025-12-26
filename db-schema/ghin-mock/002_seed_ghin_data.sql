-- Seed GHIN Mock Database with test courses
-- Based on ghinData.js mock file

-- Cedar Ridge Golf Club (Boulder, CO)
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) VALUES
('GHIN-54321', 'Cedar Ridge Golf Club', 'Boulder', 'CO', 'USA', 'GHIN-FAC-12345');

INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage) VALUES
('GHIN-TEE-1001', 'GHIN-54321', 'Blue', 'M', 1, 71.4, 136, 72, 6400),
('GHIN-TEE-1002', 'GHIN-54321', 'Blue', 'W', 1, 70.1, 125, 72, 5900),
('GHIN-TEE-1003', 'GHIN-54321', 'Red', 'M', 0, 69.8, 132, 72, 6100),
('GHIN-TEE-1004', 'GHIN-54321', 'Red', 'W', 0, 68.3, 120, 72, 5450);

-- Blue M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-1001', 1, 4, 7, 380), ('GHIN-TEE-1001', 2, 5, 3, 520), ('GHIN-TEE-1001', 3, 4, 11, 350),
('GHIN-TEE-1001', 4, 3, 17, 185), ('GHIN-TEE-1001', 5, 4, 5, 410), ('GHIN-TEE-1001', 6, 4, 13, 395),
('GHIN-TEE-1001', 7, 3, 15, 165), ('GHIN-TEE-1001', 8, 5, 1, 545), ('GHIN-TEE-1001', 9, 4, 9, 420),
('GHIN-TEE-1001', 10, 4, 8, 375), ('GHIN-TEE-1001', 11, 4, 12, 340), ('GHIN-TEE-1001', 12, 3, 18, 155),
('GHIN-TEE-1001', 13, 5, 2, 505), ('GHIN-TEE-1001', 14, 4, 6, 390), ('GHIN-TEE-1001', 15, 4, 14, 365),
('GHIN-TEE-1001', 16, 3, 16, 175), ('GHIN-TEE-1001', 17, 4, 10, 425), ('GHIN-TEE-1001', 18, 5, 4, 530);

-- Blue W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-1002', 1, 4, 7, 340), ('GHIN-TEE-1002', 2, 5, 3, 470), ('GHIN-TEE-1002', 3, 4, 11, 310),
('GHIN-TEE-1002', 4, 3, 17, 155), ('GHIN-TEE-1002', 5, 4, 5, 365), ('GHIN-TEE-1002', 6, 4, 13, 350),
('GHIN-TEE-1002', 7, 3, 15, 140), ('GHIN-TEE-1002', 8, 5, 1, 485), ('GHIN-TEE-1002', 9, 4, 9, 375),
('GHIN-TEE-1002', 10, 4, 8, 335), ('GHIN-TEE-1002', 11, 4, 12, 305), ('GHIN-TEE-1002', 12, 3, 18, 130),
('GHIN-TEE-1002', 13, 5, 2, 455), ('GHIN-TEE-1002', 14, 4, 6, 350), ('GHIN-TEE-1002', 15, 4, 14, 325),
('GHIN-TEE-1002', 16, 3, 16, 150), ('GHIN-TEE-1002', 17, 4, 10, 380), ('GHIN-TEE-1002', 18, 5, 4, 480);

-- Red M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-1003', 1, 4, 7, 360), ('GHIN-TEE-1003', 2, 5, 3, 495), ('GHIN-TEE-1003', 3, 4, 11, 330),
('GHIN-TEE-1003', 4, 3, 17, 170), ('GHIN-TEE-1003', 5, 4, 5, 390), ('GHIN-TEE-1003', 6, 4, 13, 375),
('GHIN-TEE-1003', 7, 3, 15, 150), ('GHIN-TEE-1003', 8, 5, 1, 520), ('GHIN-TEE-1003', 9, 4, 9, 400),
('GHIN-TEE-1003', 10, 4, 8, 355), ('GHIN-TEE-1003', 11, 4, 12, 320), ('GHIN-TEE-1003', 12, 3, 18, 145),
('GHIN-TEE-1003', 13, 5, 2, 485), ('GHIN-TEE-1003', 14, 4, 6, 370), ('GHIN-TEE-1003', 15, 4, 14, 345),
('GHIN-TEE-1003', 16, 3, 16, 160), ('GHIN-TEE-1003', 17, 4, 10, 405), ('GHIN-TEE-1003', 18, 5, 4, 510);

-- Red W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-1004', 1, 4, 7, 320), ('GHIN-TEE-1004', 2, 5, 3, 445), ('GHIN-TEE-1004', 3, 4, 11, 290),
('GHIN-TEE-1004', 4, 3, 17, 140), ('GHIN-TEE-1004', 5, 4, 5, 345), ('GHIN-TEE-1004', 6, 4, 13, 330),
('GHIN-TEE-1004', 7, 3, 15, 125), ('GHIN-TEE-1004', 8, 5, 1, 460), ('GHIN-TEE-1004', 9, 4, 9, 355),
('GHIN-TEE-1004', 10, 4, 8, 315), ('GHIN-TEE-1004', 11, 4, 12, 285), ('GHIN-TEE-1004', 12, 3, 18, 115),
('GHIN-TEE-1004', 13, 5, 2, 435), ('GHIN-TEE-1004', 14, 4, 6, 330), ('GHIN-TEE-1004', 15, 4, 14, 305),
('GHIN-TEE-1004', 16, 3, 16, 135), ('GHIN-TEE-1004', 17, 4, 10, 360), ('GHIN-TEE-1004', 18, 5, 4, 460);

-- Arrowhead Golf Club (Littleton, CO)
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) VALUES
('GHIN-65432', 'Arrowhead Golf Club', 'Littleton', 'CO', 'USA', 'GHIN-FAC-8765');

INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage) VALUES
('GHIN-TEE-2001', 'GHIN-65432', 'Championship', 'M', 1, 74.5, 145, 72, 6828),
('GHIN-TEE-2002', 'GHIN-65432', 'Championship', 'W', 1, 72.8, 135, 72, 6234),
('GHIN-TEE-2003', 'GHIN-65432', 'Resort', 'M', 0, 71.2, 138, 72, 6345);

-- Championship M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-2001', 1, 4, 11, 380), ('GHIN-TEE-2001', 2, 5, 9, 505), ('GHIN-TEE-2001', 3, 4, 15, 390),
('GHIN-TEE-2001', 4, 4, 7, 327), ('GHIN-TEE-2001', 5, 3, 17, 188), ('GHIN-TEE-2001', 6, 5, 3, 523),
('GHIN-TEE-2001', 7, 3, 13, 106), ('GHIN-TEE-2001', 8, 4, 1, 431), ('GHIN-TEE-2001', 9, 4, 5, 466),
('GHIN-TEE-2001', 10, 4, 6, 446), ('GHIN-TEE-2001', 11, 4, 14, 390), ('GHIN-TEE-2001', 12, 3, 16, 202),
('GHIN-TEE-2001', 13, 4, 10, 445), ('GHIN-TEE-2001', 14, 5, 2, 580), ('GHIN-TEE-2001', 15, 4, 12, 397),
('GHIN-TEE-2001', 16, 4, 8, 403), ('GHIN-TEE-2001', 17, 3, 18, 178), ('GHIN-TEE-2001', 18, 5, 4, 543);

-- Championship W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-2002', 1, 4, 11, 345), ('GHIN-TEE-2002', 2, 5, 5, 465), ('GHIN-TEE-2002', 3, 4, 15, 350),
('GHIN-TEE-2002', 4, 4, 9, 295), ('GHIN-TEE-2002', 5, 3, 17, 155), ('GHIN-TEE-2002', 6, 5, 1, 485),
('GHIN-TEE-2002', 7, 3, 13, 95), ('GHIN-TEE-2002', 8, 4, 3, 390), ('GHIN-TEE-2002', 9, 4, 7, 420),
('GHIN-TEE-2002', 10, 4, 8, 405), ('GHIN-TEE-2002', 11, 4, 14, 345), ('GHIN-TEE-2002', 12, 3, 16, 165),
('GHIN-TEE-2002', 13, 4, 10, 395), ('GHIN-TEE-2002', 14, 5, 2, 535), ('GHIN-TEE-2002', 15, 4, 12, 350),
('GHIN-TEE-2002', 16, 4, 6, 360), ('GHIN-TEE-2002', 17, 3, 18, 150), ('GHIN-TEE-2002', 18, 5, 4, 495);

-- Resort M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-2003', 1, 4, 11, 360), ('GHIN-TEE-2003', 2, 5, 9, 480), ('GHIN-TEE-2003', 3, 4, 15, 365),
('GHIN-TEE-2003', 4, 4, 7, 310), ('GHIN-TEE-2003', 5, 3, 17, 170), ('GHIN-TEE-2003', 6, 5, 3, 495),
('GHIN-TEE-2003', 7, 3, 13, 98), ('GHIN-TEE-2003', 8, 4, 1, 405), ('GHIN-TEE-2003', 9, 4, 5, 440),
('GHIN-TEE-2003', 10, 4, 6, 420), ('GHIN-TEE-2003', 11, 4, 14, 365), ('GHIN-TEE-2003', 12, 3, 16, 185),
('GHIN-TEE-2003', 13, 4, 10, 420), ('GHIN-TEE-2003', 14, 5, 2, 550), ('GHIN-TEE-2003', 15, 4, 12, 375),
('GHIN-TEE-2003', 16, 4, 8, 380), ('GHIN-TEE-2003', 17, 3, 18, 165), ('GHIN-TEE-2003', 18, 5, 4, 515);

-- The Broadmoor East Course (Colorado Springs, CO)
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) VALUES
('GHIN-76543', 'The Broadmoor East Course', 'Colorado Springs', 'CO', 'USA', 'GHIN-FAC-7654');

INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage) VALUES
('GHIN-TEE-3001', 'GHIN-76543', 'Tournament', 'M', 1, 76.2, 148, 72, 7475),
('GHIN-TEE-3002', 'GHIN-76543', 'Tournament', 'W', 1, 73.5, 140, 72, 6365),
('GHIN-TEE-3003', 'GHIN-76543', 'Members', 'M', 0, 73.8, 142, 72, 6890),
('GHIN-TEE-3004', 'GHIN-76543', 'Ladies', 'W', 0, 71.2, 135, 72, 5890);

-- Tournament M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-3001', 1, 4, 9, 445), ('GHIN-TEE-3001', 2, 5, 3, 575), ('GHIN-TEE-3001', 3, 4, 13, 350),
('GHIN-TEE-3001', 4, 3, 17, 240), ('GHIN-TEE-3001', 5, 4, 1, 495), ('GHIN-TEE-3001', 6, 3, 15, 180),
('GHIN-TEE-3001', 7, 4, 7, 450), ('GHIN-TEE-3001', 8, 5, 5, 570), ('GHIN-TEE-3001', 9, 4, 11, 460),
('GHIN-TEE-3001', 10, 4, 2, 495), ('GHIN-TEE-3001', 11, 4, 6, 520), ('GHIN-TEE-3001', 12, 3, 18, 155),
('GHIN-TEE-3001', 13, 5, 4, 510), ('GHIN-TEE-3001', 14, 4, 14, 440), ('GHIN-TEE-3001', 15, 5, 8, 550),
('GHIN-TEE-3001', 16, 3, 16, 170), ('GHIN-TEE-3001', 17, 4, 12, 440), ('GHIN-TEE-3001', 18, 4, 10, 465);

-- Tournament W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-3002', 1, 4, 9, 380), ('GHIN-TEE-3002', 2, 5, 3, 490), ('GHIN-TEE-3002', 3, 4, 13, 305),
('GHIN-TEE-3002', 4, 3, 17, 185), ('GHIN-TEE-3002', 5, 4, 1, 420), ('GHIN-TEE-3002', 6, 3, 15, 145),
('GHIN-TEE-3002', 7, 4, 7, 385), ('GHIN-TEE-3002', 8, 5, 5, 480), ('GHIN-TEE-3002', 9, 4, 11, 395),
('GHIN-TEE-3002', 10, 4, 2, 425), ('GHIN-TEE-3002', 11, 4, 6, 445), ('GHIN-TEE-3002', 12, 3, 18, 125),
('GHIN-TEE-3002', 13, 5, 4, 440), ('GHIN-TEE-3002', 14, 4, 14, 375), ('GHIN-TEE-3002', 15, 5, 8, 470),
('GHIN-TEE-3002', 16, 3, 16, 140), ('GHIN-TEE-3002', 17, 4, 12, 380), ('GHIN-TEE-3002', 18, 4, 10, 400);

-- Members M holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-3003', 1, 4, 9, 420), ('GHIN-TEE-3003', 2, 5, 3, 540), ('GHIN-TEE-3003', 3, 4, 13, 330),
('GHIN-TEE-3003', 4, 3, 17, 220), ('GHIN-TEE-3003', 5, 4, 1, 465), ('GHIN-TEE-3003', 6, 3, 15, 165),
('GHIN-TEE-3003', 7, 4, 7, 425), ('GHIN-TEE-3003', 8, 5, 5, 535), ('GHIN-TEE-3003', 9, 4, 11, 435),
('GHIN-TEE-3003', 10, 4, 2, 470), ('GHIN-TEE-3003', 11, 4, 6, 490), ('GHIN-TEE-3003', 12, 3, 18, 140),
('GHIN-TEE-3003', 13, 5, 4, 480), ('GHIN-TEE-3003', 14, 4, 14, 410), ('GHIN-TEE-3003', 15, 5, 8, 520),
('GHIN-TEE-3003', 16, 3, 16, 155), ('GHIN-TEE-3003', 17, 4, 12, 415), ('GHIN-TEE-3003', 18, 4, 10, 440);

-- Ladies W holes
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage) VALUES
('GHIN-TEE-3004', 1, 4, 9, 355), ('GHIN-TEE-3004', 2, 5, 3, 455), ('GHIN-TEE-3004', 3, 4, 13, 285),
('GHIN-TEE-3004', 4, 3, 17, 165), ('GHIN-TEE-3004', 5, 4, 1, 390), ('GHIN-TEE-3004', 6, 3, 15, 130),
('GHIN-TEE-3004', 7, 4, 7, 360), ('GHIN-TEE-3004', 8, 5, 5, 445), ('GHIN-TEE-3004', 9, 4, 11, 370),
('GHIN-TEE-3004', 10, 4, 2, 395), ('GHIN-TEE-3004', 11, 4, 6, 415), ('GHIN-TEE-3004', 12, 3, 18, 110),
('GHIN-TEE-3004', 13, 5, 4, 410), ('GHIN-TEE-3004', 14, 4, 14, 345), ('GHIN-TEE-3004', 15, 5, 8, 440),
('GHIN-TEE-3004', 16, 3, 16, 125), ('GHIN-TEE-3004', 17, 4, 12, 355), ('GHIN-TEE-3004', 18, 4, 10, 370);

-- Note: Add remaining 3 CA courses (Torrey Pines, Olympic Club, Riviera) in separate script
-- to keep this file manageable
