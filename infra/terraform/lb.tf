# Global HTTPS load balancer: /api/* → Cloud Run api, /* → web bucket (CDN).

resource "google_compute_global_address" "lb" {
  name = "${var.name_prefix}-lb-ip"
}

resource "google_compute_backend_bucket" "web" {
  name        = "${var.name_prefix}-web-backend"
  bucket_name = google_storage_bucket.web.name
  enable_cdn  = true
}

resource "google_compute_region_network_endpoint_group" "api" {
  name                  = "${var.name_prefix}-api-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

resource "google_compute_backend_service" "api" {
  name                  = "${var.name_prefix}-api-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  backend {
    group = google_compute_region_network_endpoint_group.api.id
  }
}

resource "google_compute_url_map" "main" {
  name            = "${var.name_prefix}-url-map"
  default_service = google_compute_backend_bucket.web.id

  host_rule {
    hosts        = ["*"]
    path_matcher = "all"
  }

  path_matcher {
    name            = "all"
    default_service = google_compute_backend_bucket.web.id

    path_rule {
      paths   = ["/api/*"]
      service = google_compute_backend_service.api.id
    }
  }
}

resource "google_compute_target_http_proxy" "main" {
  name    = "${var.name_prefix}-http-proxy"
  url_map = google_compute_url_map.main.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${var.name_prefix}-http-fwd"
  ip_address            = google_compute_global_address.lb.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.main.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "${var.name_prefix}-api-health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/api/v1/health"
    port         = 80
    use_ssl      = false
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = google_compute_global_address.lb.address
    }
  }

  depends_on = [google_compute_global_forwarding_rule.http]
}
