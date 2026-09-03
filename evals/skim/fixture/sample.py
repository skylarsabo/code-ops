"""Fixture module for the skim eval."""
import os
from pathlib import Path

CONSTANT = "ZZPYBODY"


def first(value):
    return value + "ZZPYBODY" + os.sep


class Second:
    def method(self):
        return Path("ZZPYBODY")


async def third():
    return "ZZPYBODY"
