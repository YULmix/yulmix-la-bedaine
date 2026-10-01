-- Where a lift leaves from, as the start of a Canadian postal code (#181): transport.departure_fsa,
-- e.g. 'H2G' (the forward sortation area). Optional: parties registered before it have none, and
-- the carpool board (#180) matches only the ones that do. The form normalises what's typed
-- (src/lib/postalCode.js, same pattern); this keeps anything else from being stored.
-- transport.departure_place stays a free-text note for people, not used for matching.

ALTER TABLE public.user_parties
    ADD CONSTRAINT user_parties_transport_departure_fsa
        CHECK (NOT (transport ? 'departure_fsa')
               OR transport->>'departure_fsa' ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z]$');

COMMENT ON CONSTRAINT user_parties_transport_departure_fsa ON public.user_parties IS
    'transport.departure_fsa, when present, is a well-formed Canadian FSA (#181), e.g. H2G.';
