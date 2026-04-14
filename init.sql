-- Cloud Codex - Database Schema
--
-- All Rights Reserved to Cloud City Computing, LLC 2026
-- https://cloudcitycomputing.com

-- SQL script to initialize the database schema.
-- This script creates the schema for workspaces, squads, users, archives, logs, versions, and permissions.
-- It defines the necessary tables and their relationships.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS comment_replies;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS squad_invitations;
DROP TABLE IF EXISTS squad_members;
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS archive_repos;
DROP TABLE IF EXISTS archives;
DROP TABLE IF EXISTS squad_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS squads;
DROP TABLE IF EXISTS two_factor_codes;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS user_invitations;
DROP TABLE IF EXISTS oauth_accounts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS workspaces;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE workspaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT,
  avatar_url VARCHAR(512) DEFAULT NULL,
  two_factor_method ENUM('none', 'email', 'totp') DEFAULT 'none',
  totp_secret VARCHAR(64) DEFAULT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE oauth_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider ENUM('google', 'github') NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255) NOT NULL,
  encrypted_token TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_provider_user (provider, provider_user_id),
  INDEX (user_id)
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

CREATE TABLE user_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token CHAR(64) NOT NULL UNIQUE,
  invited_by INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  accepted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (token),
  INDEX (email),
  INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE squads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  create_squad BOOLEAN DEFAULT FALSE,
  create_archive BOOLEAN DEFAULT FALSE,
  create_log BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE squad_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  squad_id INT NOT NULL,
  create_archive BOOLEAN DEFAULT FALSE,
  create_log BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  UNIQUE KEY (squad_id)
) ENGINE=InnoDB;

CREATE TABLE squad_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  squad_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('member', 'admin', 'owner') DEFAULT 'member',
  can_read BOOLEAN DEFAULT TRUE,
  can_write BOOLEAN DEFAULT FALSE,
  can_create_log BOOLEAN DEFAULT FALSE,
  can_create_archive BOOLEAN DEFAULT FALSE,
  can_manage_members BOOLEAN DEFAULT FALSE,
  can_delete_version BOOLEAN DEFAULT FALSE,
  can_publish BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_squad_user (squad_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE squad_invitations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  squad_id INT NOT NULL,
  invited_by INT NOT NULL,
  invited_user_id INT NOT NULL,
  role ENUM('member', 'admin', 'owner') DEFAULT 'member',
  can_read BOOLEAN DEFAULT TRUE,
  can_write BOOLEAN DEFAULT FALSE,
  can_create_log BOOLEAN DEFAULT FALSE,
  can_create_archive BOOLEAN DEFAULT FALSE,
  can_manage_members BOOLEAN DEFAULT FALSE,
  can_delete_version BOOLEAN DEFAULT FALSE,
  can_publish BOOLEAN DEFAULT FALSE,
  status ENUM('pending', 'accepted', 'declined') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_invitation (squad_id, invited_user_id, status)
) ENGINE=InnoDB;

CREATE TABLE archives (
  id INT AUTO_INCREMENT PRIMARY KEY,
  squad_id INT,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  read_access JSON DEFAULT (JSON_ARRAY()),
  write_access JSON DEFAULT (JSON_ARRAY()),
  read_access_squads JSON DEFAULT (JSON_ARRAY()),
  write_access_squads JSON DEFAULT (JSON_ARRAY()),
  read_access_workspace BOOLEAN DEFAULT FALSE,
  write_access_workspace BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE archive_repos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  archive_id INT NOT NULL,
  repo_full_name VARCHAR(255) NOT NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  linked_by INT NOT NULL,
  linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_archive_repo (archive_id, repo_full_name),
  INDEX (archive_id)
) ENGINE=InnoDB;

CREATE TABLE logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  archive_id INT,
  title TEXT NOT NULL,
  html_content TEXT,
  ydoc_state LONGBLOB DEFAULT NULL,
  plain_content TEXT GENERATED ALWAYS AS (REGEXP_REPLACE(html_content, '<[^>]+>', '')) STORED,
  parent_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT,
  version INT DEFAULT 0,
  read_access JSON DEFAULT (JSON_ARRAY()),
  write_access JSON DEFAULT (JSON_ARRAY()),
  FULLTEXT INDEX ft_logs_search (title, plain_content),
  FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES logs(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE github_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT NOT NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  branch VARCHAR(255) NOT NULL,
  file_sha VARCHAR(64) DEFAULT NULL,
  linked_by INT NOT NULL,
  linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_log_link (log_id)
) ENGINE=InnoDB;

CREATE TABLE versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT,
  version INT NOT NULL,
  title VARCHAR(255) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  html_content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT,
  read_access JSON DEFAULT (JSON_ARRAY()),
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  log_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT NOT NULL,
  tag ENUM('comment', 'suggestion', 'question', 'issue', 'note') DEFAULT 'comment',
  status ENUM('open', 'resolved', 'dismissed') DEFAULT 'open',
  selection_start INT DEFAULT NULL,
  selection_end INT DEFAULT NULL,
  selected_text TEXT DEFAULT NULL,
  resolved_by INT DEFAULT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_comments_log (log_id),
  INDEX idx_comments_status (log_id, status)
) ENGINE=InnoDB;

CREATE TABLE comment_replies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  comment_id INT NOT NULL,
  user_id INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_replies_comment (comment_id)
) ENGINE=InnoDB;

CREATE TABLE favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  log_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_favorites_user_log (user_id, log_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE,
  INDEX idx_favorites_user (user_id)
) ENGINE=InnoDB;

