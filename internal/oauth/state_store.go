package oauth

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type State struct {
	State        string
	Platform     string
	ClientID     uuid.UUID
	CreatedAtUTC time.Time
	CodeVerifier string
}

type StateStore struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]State
}

func NewStateStore(ttl time.Duration) *StateStore {
	return &StateStore{
		ttl:  ttl,
		data: map[string]State{},
	}
}

func (s *StateStore) Put(st State) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cleanupLocked(time.Now().UTC())
	s.data[st.State] = st
}

func (s *StateStore) Pop(state string) (State, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.cleanupLocked(now)

	st, ok := s.data[state]
	if !ok {
		return State{}, false
	}
	delete(s.data, state)
	return st, true
}

func (s *StateStore) cleanupLocked(now time.Time) {
	if s.ttl <= 0 {
		return
	}
	for k, v := range s.data {
		if now.Sub(v.CreatedAtUTC) > s.ttl {
			delete(s.data, k)
		}
	}
}
