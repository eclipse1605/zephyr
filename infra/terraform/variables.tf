variable "project_id" {
  type        = string
  description = "GCP project id for Zephyr"
}

variable "region" {
  type    = string
  default = "asia-south1"
}

variable "name_prefix" {
  type    = string
  default = "zephyr"
}

variable "operator_emails" {
  type        = string
  default     = ""
  description = "Comma-separated operator allowlist"
}

variable "api_image" {
  type        = string
  description = "Container image for Cloud Run api"
  default     = "gcr.io/cloudrun/hello"
}

variable "worker_image" {
  type        = string
  description = "Container image for Cloud Run worker"
  default     = "gcr.io/cloudrun/hello"
}

variable "enable_optional_vm" {
  type        = bool
  default     = false
  description = "Create an e2-micro that only publishes the tick (rubric IaaS checkbox)"
}

variable "db_tier" {
  type        = string
  default     = "db-f1-micro"
  description = "Cloud SQL machine tier"
}

variable "lb_domain" {
  type        = string
  default     = ""
  description = "Hostname for the managed HTTPS certificate. Empty keeps the load balancer on HTTP."
}
