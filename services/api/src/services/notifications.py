import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..config import (
    CALIMA_COOLDOWN_SECONDS,
    CALIMA_THRESHOLD,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
)
from ..database import SessionLocal, Subscription

_last_calima_alert: float = 0.0


def save_subscription(email: str, municipio: str | None) -> None:
    db = SessionLocal()
    try:
        existing = db.query(Subscription).filter(Subscription.email == email).first()
        if existing:
            existing.municipio = municipio
        else:
            db.add(Subscription(email=email, municipio=municipio))
        db.commit()
    finally:
        db.close()


def load_subscriptions() -> list[dict]:
    db = SessionLocal()
    try:
        subs = db.query(Subscription).all()
        return [{"email": s.email, "municipio": s.municipio} for s in subs]
    finally:
        db.close()


def _send_email(emails: list[str], subject: str, body: str) -> None:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        raise RuntimeError("SMTP not configured — set ALERT_SMTP_HOST, ALERT_SMTP_USER and ALERT_SMTP_PASS")

    sender = SMTP_FROM or SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(emails)
    msg.attach(MIMEText(body, "plain", "utf-8"))

    if SMTP_SECURE == "ssl":
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as smtp:
            smtp.login(SMTP_USER, SMTP_PASS)
            smtp.sendmail(sender, emails, msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(SMTP_USER, SMTP_PASS)
            smtp.sendmail(sender, emails, msg.as_string())


def send_confirmation(email: str) -> None:
    subject = "Suscripción a alertas de calidad del aire — Haze Guard"
    body = (
        "Te has suscrito correctamente a las alertas de calidad del aire de Haze Guard.\n\n"
        "Recibirás notificaciones cuando se detecten niveles elevados de PM2.5 o episodios de calima."
    )
    _send_email([email], subject, body)


def calima_should_fire() -> bool:
    global _last_calima_alert
    return (time.time() - _last_calima_alert) >= CALIMA_COOLDOWN_SECONDS


def send_calima_alert(
    emails: list[str],
    max_pm25: float,
    top_municipio: str | None,
    predicted: bool | None,
) -> dict:
    global _last_calima_alert

    predicted_label = " (predicción)" if predicted else ""
    location = f" en {top_municipio}" if top_municipio else ""

    subject = f"Alerta calima: PM2.5 {max_pm25:.1f} µg/m³{location}"
    body = (
        f"Haze Guard ha detectado un episodio de calima{location}.\n\n"
        f"PM2.5 máximo{predicted_label}: {max_pm25:.1f} µg/m³ "
        f"(umbral: {CALIMA_THRESHOLD} µg/m³)\n\n"
        "Recomendamos reducir la actividad física al aire libre."
    )
    _send_email(emails, subject, body)
    _last_calima_alert = time.time()
    return {"subject": subject}
