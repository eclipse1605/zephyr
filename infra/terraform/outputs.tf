output "lb_ip" {
  value = google_compute_global_address.lb.address
}

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}

output "data_bucket" {
  value = google_storage_bucket.data.name
}

output "web_bucket" {
  value = google_storage_bucket.web.name
}

output "report_topic" {
  value = google_pubsub_topic.report_events.name
}

output "bq_dataset" {
  value = google_bigquery_dataset.air.dataset_id
}
