-- Cloud Codex - Database Schema
--
-- All Rights Reserved to Cloud City Computing, LLC 2026
-- https://cloudcitycomputing.com

-- SQL script to initialize the database schema.
-- This script creates the schema for organizations, teams, users, projects, pages, versions, and permissions.
-- It defines the necessary tables and their relationships.

DROP TABLE IF EXISTS team_invitations;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS pages;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS team_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS two_factor_codes;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS organizations;

CREATE TABLE organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  two_factor_method ENUM('none', 'email', 'totp') DEFAULT 'none',
  totp_secret VARCHAR(64) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (user_id),
  INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (token),
  INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE two_factor_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  code CHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (user_id),
  INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  organization_id INT,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  create_team BOOLEAN DEFAULT FALSE,
  create_project BOOLEAN DEFAULT FALSE,
  create_page BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE team_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  create_project BOOLEAN DEFAULT FALSE,
  create_page BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE KEY (team_id)
) ENGINE=InnoDB;

CREATE TABLE team_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('member', 'admin', 'owner') DEFAULT 'member',
  can_read BOOLEAN DEFAULT TRUE,
  can_write BOOLEAN DEFAULT FALSE,
  can_create_page BOOLEAN DEFAULT FALSE,
  can_create_project BOOLEAN DEFAULT FALSE,
  can_manage_members BOOLEAN DEFAULT FALSE,
  can_delete_version BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_team_user (team_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE team_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  invited_by INT NOT NULL,
  invited_user_id INT NOT NULL,
  role ENUM('member', 'admin', 'owner') DEFAULT 'member',
  can_read BOOLEAN DEFAULT TRUE,
  can_write BOOLEAN DEFAULT FALSE,
  can_create_page BOOLEAN DEFAULT FALSE,
  can_create_project BOOLEAN DEFAULT FALSE,
  can_manage_members BOOLEAN DEFAULT FALSE,
  can_delete_version BOOLEAN DEFAULT FALSE,
  status ENUM('pending', 'accepted', 'declined') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_invitation (team_id, invited_user_id, status)
) ENGINE=InnoDB;

CREATE TABLE projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  read_access JSON DEFAULT (JSON_ARRAY()),
  write_access JSON DEFAULT (JSON_ARRAY()),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT,
  title TEXT NOT NULL,
  html_content TEXT,
  parent_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT,
  version INT DEFAULT 1,
  read_access JSON DEFAULT (JSON_ARRAY()),
  write_access JSON DEFAULT (JSON_ARRAY()),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES pages(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page_id INT,
  version INT NOT NULL,
  html_content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  read_access JSON DEFAULT (JSON_ARRAY()),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

