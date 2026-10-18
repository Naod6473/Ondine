//! Les appels longs ne monopolisent ni le runtime async, ni toutes les places
//! de travail disponibles pour les clics et les états de l'interface.
use std::sync::Arc;
use tokio::sync::Semaphore;

pub struct WorkGates {
    ai: Arc<Semaphore>,
    slow: Arc<Semaphore>,
    quick: Arc<Semaphore>,
}
impl Default for WorkGates {
    fn default() -> Self {
        Self {
            ai: Arc::new(Semaphore::new(1)),
            slow: Arc::new(Semaphore::new(2)),
            quick: Arc::new(Semaphore::new(8)),
        }
    }
}
impl WorkGates {
    pub async fn enter(
        &self,
        module: &str,
        command: &str,
    ) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
        let gate =
            if module == "askclaude" && matches!(command, "send" | "confirm" | "quick" | "reset") {
                &self.ai
            } else if is_slow(module, command) {
                &self.slow
            } else {
                &self.quick
            };
        gate.clone()
            .acquire_owned()
            .await
            .map_err(|_| "Ondine se ferme".into())
    }
}
fn is_slow(module: &str, command: &str) -> bool {
    match module {
        "askclaude" => matches!(command, "send" | "confirm" | "prepare" | "voice_transcribe"),
        "shelf" => matches!(
            command,
            "copy_to" | "move_to" | "compress" | "extract" | "hash" | "convert"
        ),
        "nettools" => !matches!(
            command,
            "status" | "speed_start" | "speed_stop" | "speed_status"
        ),
        "team" => matches!(command, "qr_scan" | "qr_frame" | "pair"),
        // Système : l'estimation et le nettoyage du disque parcourent des milliers de fichiers.
        "system" => matches!(command, "disk_estimate" | "disk_clean"),
        // Musique : les paroles attendent LRCLIB (6 s au plus).
        "media" => command == "lyrics",
        "agents" | "capture" | "weather" => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    #[test]
    fn stopping_a_speed_test_does_not_wait_for_two_busy_scanners() {
        let work = WorkGates::default();
        let _first = work.slow.clone().try_acquire_owned().unwrap();
        let _second = work.slow.clone().try_acquire_owned().unwrap();
        let mut context = Context::from_waker(Waker::noop());
        let mut scan = std::pin::pin!(work.enter("team", "qr_frame"));
        assert!(matches!(scan.as_mut().poll(&mut context), Poll::Pending));
        let mut stop = std::pin::pin!(work.enter("nettools", "speed_stop"));
        assert!(matches!(stop.as_mut().poll(&mut context), Poll::Ready(Ok(_))));
        let mut status = std::pin::pin!(work.enter("nettools", "status"));
        assert!(matches!(status.as_mut().poll(&mut context), Poll::Ready(Ok(_))));
    }
}
