# Guitar sample attribution

The bundled guitar WAV samples in `app/web/audio/guitar/` were prepared from the University of Iowa Electronic Music Studios Musical Instrument Samples (MIS) guitar recordings. The source is the 16-bit/44.1 kHz stereo guitar set (`Guitar.stereo.1644.1`), performed by Brian Penkrot on a Raimundo 118 guitar in December 2011. The MIS collection is credited to Lawrence Fritts and the University of Iowa Electronic Music Studios.

- Source recordings: https://theremin.music.uiowa.edu/MISguitar.html
- MIS usage statement: https://theremin.music.uiowa.edu/MIS.html

The MIS site states that its recordings may be downloaded and used for projects without restrictions. TabLens splits the `mf` recordings into individual notes, trims leading silence, applies conservative noise reduction where possible, and exports 16-bit/44.1 kHz stereo WAV files. `app/prepare_guitar.py` contains the preparation procedure. The original AIFF files are not included in this repository.
