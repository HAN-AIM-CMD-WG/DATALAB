"""Aanvullende Presidio ``EntityRecognizer``s voor NL-specifieke PII."""

from pii_engine.recognizers.bank import BANK_NAMES, BankNameRecognizer
from pii_engine.recognizers.bic import BicRecognizer
from pii_engine.recognizers.bsn import BsnRecognizer, is_valid_bsn
from pii_engine.recognizers.creditcard_meta import CreditCardMetaRecognizer
from pii_engine.recognizers.eu_cities import EU_CITY_NAMES, EuCityRecognizer
from pii_engine.recognizers.intl_address import IntlAddressRecognizer
from pii_engine.recognizers.han_edu import (
    EduClassRecognizer,
    EduCourseCodeRecognizer,
    EduCrohoRecognizer,
    EduLabeledPersonRecognizer,
    HanPortalStudentIdRecognizer,
    NlEmployeeIdRecognizer,
    NlOvChipkaartRecognizer,
    StageOrganizationRecognizer,
)
from pii_engine.recognizers.nl_address import NlAddressRecognizer
from pii_engine.recognizers.nl_date import NlDateRecognizer
from pii_engine.recognizers.nl_misc import (
    GpsCoordinateRecognizer,
    NlKentekenRecognizer,
)
from pii_engine.recognizers.nl_firstnames import (
    FIRST_NAMES,
    NlFirstNameRecognizer,
)
from pii_engine.recognizers.nl_identifiers import (
    BeRijksregisterRecognizer,
    NlAgbRecognizer,
    NlBigRecognizer,
    NlBtwRecognizer,
    NlIdCardRecognizer,
    NlKvkRecognizer,
    NlPolicyNumberRecognizer,
    NlRijbewijsRecognizer,
)
from pii_engine.recognizers.nl_organization import NlOrganizationRecognizer
from pii_engine.recognizers.nl_phone import NlPhoneRecognizer
from pii_engine.recognizers.nl_postcode import NlPostcodeRecognizer
from pii_engine.recognizers.nl_studentnr import NlStudentnrRecognizer
from pii_engine.recognizers.online_identifiers import OnlineIdentifierRecognizer

__all__ = [
    "BANK_NAMES",
    "BankNameRecognizer",
    "BeRijksregisterRecognizer",
    "BicRecognizer",
    "BsnRecognizer",
    "CreditCardMetaRecognizer",
    "EU_CITY_NAMES",
    "EuCityRecognizer",
    "IntlAddressRecognizer",
    "FIRST_NAMES",
    "EduClassRecognizer",
    "EduCourseCodeRecognizer",
    "EduCrohoRecognizer",
    "EduLabeledPersonRecognizer",
    "GpsCoordinateRecognizer",
    "HanPortalStudentIdRecognizer",
    "NlAddressRecognizer",
    "NlAgbRecognizer",
    "NlDateRecognizer",
    "NlFirstNameRecognizer",
    "NlIdCardRecognizer",
    "NlBigRecognizer",
    "NlBtwRecognizer",
    "NlEmployeeIdRecognizer",
    "NlKentekenRecognizer",
    "NlKvkRecognizer",
    "NlOrganizationRecognizer",
    "NlOvChipkaartRecognizer",
    "NlPhoneRecognizer",
    "NlPolicyNumberRecognizer",
    "NlPostcodeRecognizer",
    "NlRijbewijsRecognizer",
    "NlStudentnrRecognizer",
    "OnlineIdentifierRecognizer",
    "StageOrganizationRecognizer",
    "is_valid_bsn",
]
