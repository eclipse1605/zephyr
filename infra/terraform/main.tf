locals {
  apis = [
    "run.googleapis.com",
    "pubsub.googleapis.com",
    "firestore.googleapis.com",
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "secretmanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "artifactregistry.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each                   = toset(local.apis)
  project                    = var.project_id
  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = false
}

resource "google_storage_bucket" "data" {
  name                        = "${var.project_id}-data"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket" "web" {
  name                        = "${var.project_id}-web"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "web_public" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_firestore_database" "ops" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}

resource "google_bigquery_dataset" "air" {
  dataset_id = "air"
  location   = var.region
  depends_on = [google_project_service.apis]
}

resource "google_bigquery_table" "station_readings" {
  dataset_id = google_bigquery_dataset.air.dataset_id
  table_id   = "station_readings"
  time_partitioning {
    type  = "DAY"
    field = "observed_at"
  }
  clustering = ["city_id"]
  schema = jsonencode([
    { name = "station_id", type = "STRING", mode = "REQUIRED" },
    { name = "city_id", type = "STRING", mode = "REQUIRED" },
    { name = "observed_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "pm25", type = "FLOAT", mode = "NULLABLE" },
    { name = "pm10", type = "FLOAT", mode = "NULLABLE" },
    { name = "no2", type = "FLOAT", mode = "NULLABLE" },
    { name = "so2", type = "FLOAT", mode = "NULLABLE" },
    { name = "co", type = "FLOAT", mode = "NULLABLE" },
    { name = "ozone", type = "FLOAT", mode = "NULLABLE" },
    { name = "nh3", type = "FLOAT", mode = "NULLABLE" },
    { name = "aqi", type = "INTEGER", mode = "NULLABLE" },
    { name = "source", type = "STRING", mode = "REQUIRED" },
  ])
}

resource "google_bigquery_table" "exposure_snapshots" {
  dataset_id = google_bigquery_dataset.air.dataset_id
  table_id   = "exposure_snapshots"
  time_partitioning {
    type  = "DAY"
    field = "observed_at"
  }
  clustering = ["uid"]
  schema = jsonencode([
    { name = "uid", type = "STRING", mode = "REQUIRED" },
    { name = "h3", type = "STRING", mode = "REQUIRED" },
    { name = "city_id", type = "STRING", mode = "REQUIRED" },
    { name = "observed_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "aqi", type = "INTEGER", mode = "NULLABLE" },
    { name = "band", type = "STRING", mode = "NULLABLE" },
  ])
}

resource "google_bigquery_table" "ward_burden_hourly" {
  dataset_id = google_bigquery_dataset.air.dataset_id
  table_id   = "ward_burden_hourly"
  time_partitioning {
    type  = "DAY"
    field = "observed_at"
  }
  schema = jsonencode([
    { name = "city_id", type = "STRING", mode = "REQUIRED" },
    { name = "ward_id", type = "STRING", mode = "REQUIRED" },
    { name = "observed_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "aqi", type = "INTEGER", mode = "NULLABLE" },
    { name = "population", type = "INTEGER", mode = "REQUIRED" },
    { name = "unhealthy", type = "BOOLEAN", mode = "REQUIRED" },
  ])
}

resource "google_bigquery_table" "google_aq_history" {
  dataset_id = google_bigquery_dataset.air.dataset_id
  table_id   = "google_aq_history"
  time_partitioning {
    type  = "DAY"
    field = "observed_at"
  }
  schema = jsonencode([
    { name = "station_id", type = "STRING", mode = "NULLABLE" },
    { name = "h3", type = "STRING", mode = "NULLABLE" },
    { name = "observed_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "pm25", type = "FLOAT", mode = "NULLABLE" },
  ])
}

resource "google_pubsub_topic" "report_events" {
  name       = "${var.name_prefix}-report-events"
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "report_events_dlq" {
  name = "${var.name_prefix}-report-events-dlq"
}

resource "google_service_account" "api" {
  account_id   = "${var.name_prefix}-api"
  display_name = "Zephyr API"
}

resource "google_service_account" "worker" {
  account_id   = "${var.name_prefix}-worker"
  display_name = "Zephyr Worker"
}

resource "google_service_account" "scheduler" {
  account_id   = "${var.name_prefix}-scheduler"
  display_name = "Zephyr Scheduler"
}

resource "google_service_account" "pubsub_push" {
  account_id   = "${var.name_prefix}-pubsub-push"
  display_name = "Zephyr Pub/Sub push"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "${var.name_prefix}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    containers {
      image = var.api_image
      ports { container_port = 8080 }
      env {
        name  = "ZEPHYR_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "ZEPHYR_BUCKET"
        value = google_storage_bucket.data.name
      }
      env {
        name  = "ZEPHYR_REPORT_TOPIC"
        value = google_pubsub_topic.report_events.name
      }
      env {
        name  = "OPERATOR_EMAILS"
        value = var.operator_emails
      }
      env {
        name  = "WORKER_URL"
        value = google_cloud_run_v2_service.worker.uri
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "worker" {
  name     = "${var.name_prefix}-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.worker.email
    scaling {
      min_instance_count = 0
      max_instance_count = 20
    }
    containers {
      image = var.worker_image
      ports { container_port = 8080 }
      env {
        name  = "ZEPHYR_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "ZEPHYR_BUCKET"
        value = google_storage_bucket.data.name
      }
      env {
        name  = "ZEPHYR_REPORT_TOPIC"
        value = google_pubsub_topic.report_events.name
      }
      env {
        name  = "ZEPHYR_BQ_DATASET"
        value = google_bigquery_dataset.air.dataset_id
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = google_cloud_run_v2_service.api.project
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "worker_scheduler" {
  project  = google_cloud_run_v2_service.worker.project
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_run_v2_service_iam_member" "worker_pubsub" {
  project  = google_cloud_run_v2_service.worker.project
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_push.email}"
}

resource "google_cloud_run_v2_service_iam_member" "worker_api" {
  project  = google_cloud_run_v2_service.worker.project
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_pubsub_subscription" "report_events_push" {
  name  = "${var.name_prefix}-report-events-push"
  topic = google_pubsub_topic.report_events.name

  ack_deadline_seconds = 60
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker.uri}/internal/pubsub/reports"
    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.report_events_dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

resource "google_pubsub_subscription" "dlq_record" {
  name  = "${var.name_prefix}-dlq-record"
  topic = google_pubsub_topic.report_events_dlq.name
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker.uri}/internal/pubsub/dlq"
    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
    }
  }
}

resource "google_cloud_tasks_queue" "alerts" {
  name     = "${var.name_prefix}-alerts"
  location = var.region
  depends_on = [google_project_service.apis]
}

resource "google_cloud_scheduler_job" "tick" {
  name             = "${var.name_prefix}-tick"
  schedule         = "*/30 * * * *"
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/internal/tick"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience               = google_cloud_run_v2_service.worker.uri
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "keys" {
  for_each = toset([
    "OPENAQ_API_KEY",
    "WAQI_API_TOKEN",
    "CPCB_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_AIR_QUALITY_API_KEY",
    "GOOGLE_PLACES_API_KEY",
    "GOOGLE_SPEECH_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_FROM",
    "WHATSAPP_CLOSURE_SECRET",
    "FIREBASE_SERVICE_ACCOUNT_KEY",
  ])
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# IAM — API
resource "google_project_iam_member" "api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "api_objects" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_pubsub_topic_iam_member" "api_publish" {
  topic  = google_pubsub_topic.report_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_secrets" {
  for_each  = google_secret_manager_secret.keys
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_tasks_queue_iam_member" "api_tasks" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.alerts.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.api.email}"
}

# IAM — Worker
resource "google_project_iam_member" "worker_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_bq_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_bq_job" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "worker_objects" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_pubsub_topic_iam_member" "worker_publish" {
  topic  = google_pubsub_topic.report_events.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_secrets" {
  for_each  = google_secret_manager_secret.keys
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_tasks_queue_iam_member" "worker_tasks" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.alerts.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.worker.email}"
}

# Optional IaaS checkbox VM — publishes tick only
resource "google_compute_instance" "tick_publisher" {
  count        = var.enable_optional_vm ? 1 : 0
  name         = "${var.name_prefix}-tick-vm"
  machine_type = "e2-micro"
  zone         = "${var.region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  network_interface {
    network = "default"
    access_config {}
  }

  metadata_startup_script = <<-EOT
    #!/bin/bash
    # This VM only curls the worker tick on a cron; no app code.
    apt-get update && apt-get install -y curl
    echo '*/30 * * * * curl -sS -X POST ${google_cloud_run_v2_service.worker.uri}/internal/tick' | crontab -
  EOT

  service_account {
    email  = google_service_account.scheduler.email
    scopes = ["cloud-platform"]
  }
}
