# mock-idp

Local stand-in for the Telia ID Broker: `navikt/mock-oauth2-server` configured with an `ftn` issuer whose login page accepts arbitrary FTN-shaped claims (`personal_identity_code`, `name`, `birthdate`, `acr`, `amr`). Wired into `docker-compose.yml` by issue #5. Never used on staging or production; the real test bed is wired only on staging.
