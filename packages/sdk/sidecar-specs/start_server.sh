#!/bin/bash
# 0G Bridge gRPC Server Startup Script

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
BINARY="$SERVER_DIR/bin/zerog-bridge"
LOG_FILE="${LOG_FILE:-/tmp/zerog-bridge.log}"
PID_FILE="/tmp/zerog-bridge.pid"

# Environment variables with defaults
ZEROG_EVM_RPC="${ZEROG_EVM_RPC:-https://evmrpc-testnet.0g.ai/}"
ZEROG_INDEXER_RPC="${ZEROG_INDEXER_RPC:-https://indexer-storage-testnet-turbo.0g.ai}"

# Check if private key is set
if [ -z "$ZEROG_PRIVATE_KEY" ]; then
    echo -e "${RED}ERROR: ZEROG_PRIVATE_KEY environment variable is required${NC}"
    echo ""
    echo "Usage:"
    echo "  ZEROG_PRIVATE_KEY=<your_key> $0 [start|stop|restart|status|logs]"
    echo ""
    echo "Example:"
    echo "  ZEROG_PRIVATE_KEY=0xabc123... $0 start"
    exit 1
fi

# Function to check if server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Function to start server
start_server() {
    if is_running; then
        echo -e "${YELLOW}Server is already running (PID: $(cat $PID_FILE))${NC}"
        exit 0
    fi

    echo -e "${GREEN}Starting 0G Bridge gRPC Server...${NC}"
    echo ""
    echo "Configuration:"
    echo "  EVM RPC:     $ZEROG_EVM_RPC"
    echo "  Indexer RPC: $ZEROG_INDEXER_RPC"
    echo "  Log File:    $LOG_FILE"
    echo ""

    # Check if binary exists
    if [ ! -f "$BINARY" ]; then
        echo -e "${RED}ERROR: Binary not found at $BINARY${NC}"
        echo "Building server..."
        cd "$SERVER_DIR"
        go build -o bin/zerog-bridge main.go
    fi

    # Start server in background
    cd "$SERVER_DIR"
    nohup env \
        ZEROG_PRIVATE_KEY="$ZEROG_PRIVATE_KEY" \
        ZEROG_EVM_RPC="$ZEROG_EVM_RPC" \
        ZEROG_INDEXER_RPC="$ZEROG_INDEXER_RPC" \
        "$BINARY" > "$LOG_FILE" 2>&1 &
    
    SERVER_PID=$!
    echo $SERVER_PID > "$PID_FILE"

    # Wait for startup
    echo -n "Waiting for server to start"
    for i in {1..10}; do
        sleep 0.5
        echo -n "."
        if grpcurl -plaintext -max-time 1 localhost:50051 list > /dev/null 2>&1; then
            echo ""
            echo -e "${GREEN}✅ Server started successfully!${NC}"
            echo ""
            echo "PID: $SERVER_PID"
            echo "Storage Service: localhost:50051"
            echo "Compute Service: localhost:50052"
            echo ""
            echo "Test with:"
            echo "  grpcurl -plaintext -d '{}' localhost:50051 grpc.health.v1.Health/Check"
            echo ""
            echo "View logs:"
            echo "  tail -f $LOG_FILE"
            return 0
        fi
    done

    echo ""
    echo -e "${RED}ERROR: Server failed to start${NC}"
    echo "Check logs: tail -f $LOG_FILE"
    exit 1
}

# Function to stop server
stop_server() {
    if ! is_running; then
        echo -e "${YELLOW}Server is not running${NC}"
        exit 0
    fi

    PID=$(cat "$PID_FILE")
    echo -e "${YELLOW}Stopping server (PID: $PID)...${NC}"
    kill "$PID" 2>/dev/null || true
    
    # Wait for graceful shutdown
    for i in {1..5}; do
        if ! ps -p "$PID" > /dev/null 2>&1; then
            rm -f "$PID_FILE"
            echo -e "${GREEN}✅ Server stopped${NC}"
            return 0
        fi
        sleep 1
    done

    # Force kill if still running
    echo "Forcing shutdown..."
    kill -9 "$PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo -e "${GREEN}✅ Server stopped (forced)${NC}"
}

# Function to show status
show_status() {
    if is_running; then
        PID=$(cat "$PID_FILE")
        echo -e "${GREEN}🟢 Server is running${NC}"
        echo "PID: $PID"
        echo "Storage Service: localhost:50051"
        echo "Compute Service: localhost:50052"
        echo ""
        
        # Test health
        if grpcurl -plaintext -max-time 2 -d '{}' localhost:50051 grpc.health.v1.Health/Check > /dev/null 2>&1; then
            echo -e "Health Check: ${GREEN}✓ HEALTHY${NC}"
        else
            echo -e "Health Check: ${RED}✗ UNHEALTHY${NC}"
        fi
    else
        echo -e "${RED}🔴 Server is not running${NC}"
    fi
}

# Function to show logs
show_logs() {
    if [ ! -f "$LOG_FILE" ]; then
        echo -e "${RED}Log file not found: $LOG_FILE${NC}"
        exit 1
    fi
    
    if [ "$1" = "-f" ] || [ "$1" = "--follow" ]; then
        tail -f "$LOG_FILE"
    else
        tail -50 "$LOG_FILE"
    fi
}

# Main command handler
COMMAND="${1:-start}"

case "$COMMAND" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server
        sleep 2
        start_server
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs [-f]}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the gRPC server"
        echo "  stop     - Stop the gRPC server"
        echo "  restart  - Restart the gRPC server"
        echo "  status   - Show server status"
        echo "  logs     - Show last 50 log lines"
        echo "  logs -f  - Follow logs in real-time"
        exit 1
        ;;
esac

