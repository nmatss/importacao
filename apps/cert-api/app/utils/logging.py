"""Logging configuration for cert-api."""

import logging


def get_logger(name: str = "cert-api") -> logging.Logger:
    """Get a configured logger instance.

    Args:
        name: Logger name, defaults to 'cert-api'.

    Returns:
        Configured Logger instance.
    """
    logging.basicConfig(level=logging.INFO)
    return logging.getLogger(name)


log: logging.Logger = get_logger()


def log_safe(value: object) -> str:
    """Sanitize a user-provided value for log interpolation (anti log-injection).

    Strips CR/LF so request input can't forge extra log lines.

    Args:
        value: Any value destined for a log message.

    Returns:
        Single-line string representation.
    """
    return str(value).replace("\r", " ").replace("\n", " ")
