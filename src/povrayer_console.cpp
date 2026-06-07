//******************************************************************************
///
/// @file vfe/unix/povrayer_console.cpp
///
/// Derived from @ref vfe/unix/unixconsole.cpp (itself adapted from
/// @ref vfe/win/console/winconsole.cpp) for the povrayer WebAssembly build.
///
/// Removed relative to unixconsole.cpp: the sigwait signal-handler thread and
/// all signal processing (sigwait blocks forever under emscripten), the
/// built-in benchmark (termios/select on stdin), every SDL/text display path
/// including the pov_frontend::gDisplay definition (referenced only by the
/// never-compiled unix/disp* sources), and Pause_When_Done handling. Display
/// mode is always "none": the registered display creator returns nullptr.
///
/// @copyright
/// @parblock
///
/// Persistence of Vision Ray Tracer ('POV-Ray') version 3.8.
/// Copyright 1991-2019 Persistence of Vision Raytracer Pty. Ltd.
///
/// POV-Ray is free software: you can redistribute it and/or modify
/// it under the terms of the GNU Affero General Public License as
/// published by the Free Software Foundation, either version 3 of the
/// License, or (at your option) any later version.
///
/// POV-Ray is distributed in the hope that it will be useful,
/// but WITHOUT ANY WARRANTY; without even the implied warranty of
/// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
/// GNU Affero General Public License for more details.
///
/// You should have received a copy of the GNU Affero General Public License
/// along with this program.  If not, see <http://www.gnu.org/licenses/>.
///
/// ----------------------------------------------------------------------------
///
/// POV-Ray is based on the popular DKB raytracer version 2.12.
/// DKBTrace was originally written by David K. Buck.
/// DKBTrace Ver 2.0-2.12 were written by David K. Buck & Aaron A. Collins.
///
/// @endparblock
///
//******************************************************************************

// C++ variants of C standard header files
#include <cstdio>
#include <cstdlib>

// C++ standard header files
#include <memory>
#include <string>

// Other library header files
#include <unistd.h>

// from directory "vfe"
#include "vfe.h"

// from directory "vfe/unix" (upstream pulls this in transitively via the
// removed disp_text.h; we need the full UnixOptionsProcessor definition)
#include "unixoptions.h"

// from directory "source"
#include "backend/povray.h"

using namespace vfe;
using namespace vfePlatform;

enum ReturnValue
{
    RETURN_OK=0,
    RETURN_ERROR,
    RETURN_USER_ABORT
};

// Display mode is always "none". The core code only asks for a display when a
// preview is requested (+D); returning nullptr here is the documented
// "no display" case (see vfeSession::CreateDisplay), and matches upstream
// unixconsole.cpp behavior under DISP_MODE_NONE.
static vfeDisplay *NullDisplayCreator (unsigned int width, unsigned int height, vfeSession *session, bool visible)
{
    return nullptr;
}

static void PrintStatus (vfeSession *session)
{
    // TODO -- when invoked while processing "--help" command-line switch,
    //         GNU/Linux customs would be to print to stdout (among other differences).

    std::string str;
    vfeSession::MessageType type;
    static vfeSession::MessageType lastType = vfeSession::mUnclassified;

    while (session->GetNextCombinedMessage (type, str))
    {
        if (type != vfeSession::mGenericStatus)
        {
            if (lastType == vfeSession::mGenericStatus)
                fprintf (stderr, "\n") ;
            fprintf (stderr, "%s\n", str.c_str());
        }
        else
            fprintf (stderr, "%s\r", str.c_str());
        lastType = type;
    }
}

static void PrintStatusChanged (vfeSession *session, State force = kUnknown)
{
    if (force == kUnknown)
        force = session->GetBackendState();
    switch (force)
    {
        case kParsing:
            fprintf (stderr, "==== [Parsing...] ==========================================================\n");
            break;
        case kRendering:
            fprintf (stderr, "==== [Rendering...] ========================================================\n");
            break;
        case kPausedRendering:
            fprintf (stderr, "==== [Paused...] ===========================================================\n");
            break;
        default:
            // Do nothing special.
            break;
    }
}

static void PrintVersion(void)
{
    // TODO -- GNU/Linux customs would be to print to stdout (among other differences).

    fprintf(stderr,
        "%s %s\n\n"
        "%s\n%s\n%s\n"
        "%s\n%s\n%s\n\n",
        PACKAGE_NAME, POV_RAY_VERSION,
        DISTRIBUTION_MESSAGE_1, DISTRIBUTION_MESSAGE_2, DISTRIBUTION_MESSAGE_3,
        POV_RAY_COPYRIGHT, DISCLAIMER_MESSAGE_1, DISCLAIMER_MESSAGE_2
    );
    fprintf(stderr,
        "Built-in features:\n"
        "  I/O restrictions:          %s\n"
        "  X Window display:          %s\n"
        "  Supported image formats:   %s\n"
        "  Unsupported image formats: %s\n\n",
        BUILTIN_IO_RESTRICTIONS, BUILTIN_XWIN_DISPLAY, BUILTIN_IMG_FORMATS, MISSING_IMG_FORMATS
    );
    fprintf(stderr,
        "Compilation settings:\n"
        "  Build architecture:  %s\n"
        "  Built/Optimized for: %s\n"
        "  Compiler vendor:     %s\n"
        "  Compiler version:    %s\n"
        "  Compiler flags:      %s\n",
        BUILD_ARCH, BUILT_FOR, COMPILER_VENDOR, COMPILER_VERSION, CXXFLAGS
    );
}

static void PrintGeneration(void)
{
    fprintf(stdout, "%s\n", POV_RAY_GENERATION POV_RAY_BETA_SUFFIX);
}

static void ErrorExit(vfeSession *session)
{
    fprintf(stderr, "%s\n", session->GetErrorString());
    session->Shutdown();
    delete session;
    // PROXY_TO_PTHREAD + EXIT_RUNTIME stdout-truncation guard (emscripten #15043)
    fflush(stdout);
    fflush(stderr);
    std::exit(RETURN_ERROR);
}

int main (int argc, char **argv)
{
    vfeUnixSession   *session;
    vfeStatusFlags    flags;
    vfeRenderOptions  opts;
    ReturnValue       retval = RETURN_OK;
    char **           argv_copy=argv; /* because argv is updated later */
    int               argc_copy=argc; /* because it might also be updated */

    session = new vfeUnixSession();
    if (session->Initialize(nullptr, nullptr) != vfeNoError)
        ErrorExit(session);

    // default number of work threads: number of CPUs or 4
    // (emscripten maps sysconf(_SC_NPROCESSORS_ONLN) to navigator.hardwareConcurrency)
    int nthreads = 1;
#ifdef _SC_NPROCESSORS_ONLN  // online processors
    nthreads = sysconf(_SC_NPROCESSORS_ONLN);
#endif
#ifdef _SC_NPROCESSORS_CONF  // configured processors
    if (nthreads < 2)
        nthreads = sysconf(_SC_NPROCESSORS_CONF);
#endif
    if (nthreads < 2)
        nthreads = 4;
    opts.SetThreadCount(nthreads);

    // process command-line options
    session->GetUnixOptions()->ProcessOptions(&argc, &argv);
    if (session->GetUnixOptions()->isOptionSet("general", "help"))
    {
        session->Shutdown() ;
        PrintStatus (session) ;
        // TODO: general usage display (not yet in core code)
        session->GetUnixOptions()->PrintOptions();
        delete session;
        fflush(stdout);
        fflush(stderr);
        return RETURN_OK;
    }
    else if (session->GetUnixOptions()->isOptionSet("general", "version"))
    {
        session->Shutdown() ;
        PrintVersion();
        delete session;
        fflush(stdout);
        fflush(stderr);
        return RETURN_OK;
    }
    else if (session->GetUnixOptions()->isOptionSet("general", "generation"))
    {
        session->Shutdown();
        PrintGeneration();
        delete session;
        fflush(stdout);
        fflush(stderr);
        return RETURN_OK;
    }

    // process INI settings
    char *s = std::getenv ("POVINC");
    session->SetDisplayCreator(NullDisplayCreator);
    session->GetUnixOptions()->Process_povray_ini(opts);
    if (s != nullptr)
        opts.AddLibraryPath (s);
    while (*++argv)
        opts.AddCommand (*argv);

    // set all options and start rendering
    if (session->SetOptions(opts) != vfeNoError)
    {
        fprintf(stderr,"\nProblem with option setting\n");
        for(int loony=0;loony<argc_copy;loony++)
        {
            fprintf(stderr,"%s%c",argv_copy[loony],loony+1<argc_copy?' ':'\n');
        }
        ErrorExit(session);
    }
    if (session->StartRender() != vfeNoError)
        ErrorExit(session);

    // main render loop
    session->SetEventMask(stBackendStateChanged);  // immediately notify this event
    while (((flags = session->GetStatus(true, 200)) & stRenderShutdown) == 0)
    {
        if (flags & stAnimationStatus)
            fprintf(stderr, "\nRendering frame %d of %d (#%d)\n", session->GetCurrentFrame(), session->GetTotalFrames(), session->GetCurrentFrameId());
        if (flags & stAnyMessage)
            PrintStatus (session);
        if (flags & stBackendStateChanged)
            PrintStatusChanged (session);
    }

    if (session->Succeeded() == false)
        retval = RETURN_ERROR;
    session->Shutdown();
    PrintStatus (session);
    delete session;

    // PROXY_TO_PTHREAD + EXIT_RUNTIME stdout-truncation guard (emscripten #15043)
    fflush(stdout);
    fflush(stderr);

    return retval;
}
