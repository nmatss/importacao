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
